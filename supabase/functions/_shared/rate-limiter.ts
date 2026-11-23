import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { resolveRedisConfig, redisFixedWindowIncr } from "./redis.ts";

// Module-level shared client - created once per isolate lifetime
let _sharedClient: any = null;
function getSharedClient() {
  if (!_sharedClient) {
    _sharedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _sharedClient;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (best effort). */
  retryAfterSeconds?: number;
  /** Which backend served the decision. */
  backend?: "redis" | "postgres" | "fail-open" | "fail-closed";
};

export type RateLimitOptions = {
  /**
   * When both Redis and Postgres fail:
   * - true: deny (safer for OTP/auth/payment)
   * - false: allow (legacy availability bias)
   * Default: RATE_LIMIT_FAIL_CLOSED=true/1/yes OR false.
   */
  failClosed?: boolean;
};

function resolveFailClosed(options?: RateLimitOptions): boolean {
  if (typeof options?.failClosed === "boolean") return options.failClosed;
  const env = (Deno.env.get("RATE_LIMIT_FAIL_CLOSED") || "").trim().toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

/**
 * Shared rate limiter for edge functions.
 *
 * Order:
 * 1) Upstash Redis (when UPSTASH_REDIS_REST_URL + TOKEN are set)
 * 2) Postgres public.rate_limits table
 * 3) fail-closed or fail-open per options/env
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  const failClosed = resolveFailClosed(options);
  const supabase = getSharedClient();

  // Prefer Redis (env or vault/admin_settings) before hitting Postgres rate_limits.
  const redisCfg = await resolveRedisConfig(supabase);
  if (redisCfg) {
    try {
      const redis = await redisFixedWindowIncr(key, windowSeconds, supabase);
      if (redis) {
        const remaining = Math.max(0, maxRequests - redis.count);
        if (redis.count > maxRequests) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: redis.ttlSeconds,
            backend: "redis",
          };
        }
        return {
          allowed: true,
          remaining,
          retryAfterSeconds: redis.ttlSeconds,
          backend: "redis",
        };
      }
    } catch (error) {
      console.error("[rate-limiter] Redis error; falling back to Postgres:", error);
    }
  }

  try {
    const pg = await checkRateLimitPostgres(supabase, key, maxRequests, windowSeconds);
    return { ...pg, backend: "postgres" };
  } catch (error) {
    console.error("[rate-limiter] Postgres error:", error);
    if (failClosed) {
      return { allowed: false, remaining: 0, retryAfterSeconds: 60, backend: "fail-closed" };
    }
    return { allowed: true, remaining: maxRequests, backend: "fail-open" };
  }
}

async function checkRateLimitPostgres(
  supabase: any,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

  const { data: existing, error: readError } = await supabase
    .from("rate_limits")
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    const existingWindowStart = new Date(existing.window_start);
    const windowAgeMs = now.getTime() - existingWindowStart.getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowSeconds * 1000 - windowAgeMs) / 1000),
    );

    if (existingWindowStart < windowStart) {
      const { error } = await supabase
        .from("rate_limits")
        .update({ count: 1, window_start: now.toISOString() })
        .eq("key", key)
        .eq("window_start", existing.window_start);

      if (error) {
        return checkRateLimitRetry(supabase, key, maxRequests, windowSeconds);
      }
      return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: windowSeconds };
    }

    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
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

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - updated.count),
      retryAfterSeconds,
    };
  }

  const { error: upsertError } = await supabase
    .from("rate_limits")
    .upsert(
      { key, count: 1, window_start: now.toISOString() },
      { onConflict: "key" },
    );

  if (upsertError) {
    throw upsertError;
  }

  return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: windowSeconds };
}

async function checkRateLimitRetry(
  supabase: any,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabase
    .from("rate_limits")
    .select("count, window_start")
    .eq("key", key)
    .single();

  if (error) throw error;
  if (!data) {
    return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: windowSeconds };
  }

  const windowAgeMs = Date.now() - new Date(data.window_start).getTime();
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowSeconds * 1000 - windowAgeMs) / 1000),
  );

  if (data.count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  const { data: updated, error: updateError } = await supabase
    .from("rate_limits")
    .update({ count: data.count + 1 })
    .eq("key", key)
    .eq("count", data.count)
    .select("count")
    .single();

  if (updateError || !updated) {
    const { data: final } = await supabase
      .from("rate_limits")
      .select("count")
      .eq("key", key)
      .single();
    if (!final || final.count >= maxRequests) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - final.count),
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - updated.count),
    retryAfterSeconds,
  };
}

export function rateLimitResponse(
  corsHeaders: Record<string, string>,
  retryAfterSeconds?: number,
) {
  const retry = Math.max(1, Math.floor(retryAfterSeconds || 60));
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please try again later.",
      retry_after_seconds: retry,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retry),
      },
    },
  );
}
