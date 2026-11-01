import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function withAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { userId: user.id, userClient };
}

async function checkRateLimit(key: string, maxRequests: number, windowSeconds: number) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);
    const { data: existing } = await supabase.from("rate_limits").select("*").eq("key", key).maybeSingle();

    if (existing) {
      const existingWindowStart = new Date(existing.window_start);
      if (existingWindowStart < windowStart) {
        await supabase.from("rate_limits").update({ count: 1, window_start: now.toISOString() }).eq("key", key);
        return { allowed: true };
      }
      if (existing.count >= maxRequests) return { allowed: false };
      await supabase.from("rate_limits").update({ count: existing.count + 1 }).eq("key", key).eq("count", existing.count);
      return { allowed: true };
    }

    await supabase.from("rate_limits").upsert(
      { key, count: 1, window_start: now.toISOString() },
      { onConflict: "key" },
    );
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

async function getCredential(
  supabase: ReturnType<typeof createClient>,
  dbKey: string,
  envKey: string,
): Promise<string | undefined> {
  const fromEnv = (Deno.env.get(envKey) || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { data, error } = await supabase.rpc("get_edge_credential", { p_key: dbKey });
    if (!error && typeof data === "string" && data.trim()) return data.trim();
  } catch (e) {
    console.warn("get_edge_credential failed", e);
  }
  return undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigitOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

async function sendResendEmail(opts: {
  apiKey: string;
  to: string;
  code: string;
  from: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: "Sociva A Cleaner City - work email verification code",
      text:
        `Your Sociva work email verification code is ${opts.code}.\n\n` +
        `It expires in 10 minutes. If you did not request this, ignore this email.\n\n` +
        `Badge after verification: Work email verified (not employment independently verified).`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Resend failed (${res.status}): ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await withAuth(req);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const body = await req.json();
    const action = String(body?.action || "send");
    const email = String(body?.email || "").trim().toLowerCase();
    const code = String(body?.code || "").trim();

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid work email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "verify") {
      const rl = await checkRateLimit(`cc-work-email-verify:${userId}`, 20, 600);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!/^\d{6}$/.test(code)) {
        return new Response(JSON.stringify({ error: "Enter the 6-digit code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const otpHash = await sha256Hex(`${userId}:${email}:${code}`);
      const { data, error } = await adminClient.rpc("cleaner_city_verify_work_email_otp_hash", {
        p_user_id: userId,
        p_email: email,
        p_otp_hash: otpHash,
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message || "Verification failed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, verification: data, badge: "Work email verified" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rl = await checkRateLimit(`cc-work-email-send:${userId}`, 5, 600);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const otp = sixDigitOtp();
    const otpHash = await sha256Hex(`${userId}:${email}:${otp}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: storeError } = await adminClient.rpc("cleaner_city_store_work_email_otp", {
      p_user_id: userId,
      p_email: email,
      p_otp_hash: otpHash,
      p_otp_expires_at: expiresAt,
    });

    if (storeError) {
      return new Response(JSON.stringify({ error: storeError.message || "Could not start verification" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = await getCredential(adminClient, "resend_api_key", "RESEND_API_KEY");
    const from =
      (await getCredential(adminClient, "resend_from_email", "RESEND_FROM_EMAIL")) ||
      "Sociva <onboarding@resend.dev>";

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Email provider not configured. Set RESEND_API_KEY (or vault key resend_api_key) before sending work-email OTPs.",
          code: "email_provider_missing",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sent = await sendResendEmail({ apiKey, to: email, code: otp, from });
    if (!sent.ok) {
      return new Response(JSON.stringify({ error: sent.error || "Failed to send email" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Verification code sent to your work email",
        expires_at: expiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[cleaner-city-work-email-otp]", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
