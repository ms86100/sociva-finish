import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

// Module-level shared client — created once per isolate lifetime
let _sharedClient: any = null;
function getSharedClient() {
  if (!_sharedClient) {
    _sharedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return _sharedClient;
}

/**
 * Shared rate limiter for edge functions.
 * Uses atomic upsert to prevent race conditions under concurrency.
 * Reuses a module-level Supabase client to avoid cold-start overhead.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const supabase = getSharedClient();
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);

    const { data: existing } = await supabase
      .from("rate_limits")
      .select("*")
      .eq("key", key)
      .single();

    if (existing) {
      const existingWindowStart = new Date(existing.window_start);

      if (existingWindowStart < windowStart) {
        const { error } = await supabase
          .from("rate_limits")
          .update({ count: 1, window_start: now.toISOString() })
          .eq("key", key)
          .eq("window_start", existing.window_start);

        if (error) {
          return checkRateLimitRetry(supabase, key, maxRequests, windowSeconds);
        }
        return { allowed: true, remaining: maxRequests - 1 };
      }

      if (existing.count >= maxRequests) {
        return { allowed: false, remaining: 0 };
      }

      const { data: updated, error } = await supabase
        .from("rate_limits")
        .update({ count: existing.count + 1 })
        .eq("key", key)
        .eq("count", existing.count)
        .select("count")
        .single();

      if (error || !updated) {
        return checkRateLimitRetry(supabase, key, maxRequests, windowSeconds);
      }

      return { allowed: true, remaining: maxRequests - updated.count };
    }

    await supabase
      .from("rate_limits")
      .upsert(
        { key, count: 1, window_start: now.toISOString() },
        { onConflict: "key" }
      );

    return { allowed: true, remaining: maxRequests - 1 };
  } catch (error) {
    console.error("Rate limiter error (allowing request):", error);
    return { allowed: true, remaining: maxRequests };
  }
}

async function checkRateLimitRetry(
  supabase: any,
  key: string,
  maxRequests: number,
  _windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const { data } = await supabase
    .from("rate_limits")
    .select("count")
    .eq("key", key)
    .single();

  if (!data) return { allowed: true, remaining: maxRequests - 1 };

  if (data.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  const { data: updated, error } = await supabase
    .from("rate_limits")
    .update({ count: data.count + 1 })
    .eq("key", key)
    .eq("count", data.count)
    .select("count")
    .single();

  if (error || !updated) {
    const { data: final } = await supabase.from("rate_limits").select("count").eq("key", key).single();
    if (!final || final.count >= maxRequests) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: maxRequests - final.count };
  }

  return { allowed: true, remaining: maxRequests - updated.count };
}

export function rateLimitResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
