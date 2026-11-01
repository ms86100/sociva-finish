import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapStoreError(message: string): { error: string; code: string } {
  const m = (message || "").toLowerCase();
  if (m.includes("not an approved")) {
    return {
      code: "domain_not_approved",
      error:
        "Your company email domain is not approved yet. Open Set up commute, check Approved companies, and request your domain if it is missing.",
    };
  }
  if (m.includes("personal or disposable")) {
    return {
      code: "personal_email",
      error: "Personal inboxes like Gmail or Yahoo are not allowed. Use your official company email.",
    };
  }
  if (m.includes("not enabled")) {
    return {
      code: "feature_disabled",
      error: "A Cleaner City is not enabled for your society yet. Ask your society admin.",
    };
  }
  if (m.includes("society membership")) {
    return {
      code: "no_society",
      error: "Join a society in Sociva before verifying a work email.",
    };
  }
  if (m.includes("invalid email")) {
    return { code: "invalid_email", error: "Enter a valid work email address." };
  }
  return { code: "store_failed", error: message || "Could not start verification" };
}

function mapResendError(status: number, body: string): { error: string; code: string } {
  const lower = (body || "").toLowerCase();
  if (status === 403 || lower.includes("only send testing emails") || lower.includes("verify a domain")) {
    return {
      code: "email_domain_unverified",
      error:
        "Email sending is limited until Sociva finishes Resend domain setup. Ask an admin to set a verified From address (resend_from_email).",
    };
  }
  if (status === 422 && lower.includes("from")) {
    return {
      code: "email_from_invalid",
      error: "Outgoing From address is invalid. Ask an admin to configure resend_from_email.",
    };
  }
  return {
    code: "email_send_failed",
    error: `Could not send verification email (${status}). Try again in a minute.`,
  };
}

async function withAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Please sign in again", code: "unauthorized" }, 401);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return json({ error: "Please sign in again", code: "unauthorized" }, 401);
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
}): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
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
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body, error: body.slice(0, 240) };
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
      return json({ error: "Enter a valid work email address", code: "invalid_email" }, 400);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "verify") {
      const rl = await checkRateLimit(`cc-work-email-verify:${userId}`, 20, 600);
      if (!rl.allowed) {
        return json({ error: "Too many attempts. Wait a few minutes and try again.", code: "rate_limited" }, 429);
      }

      if (!/^\d{6}$/.test(code)) {
        return json({ error: "Enter the 6-digit code from your email", code: "invalid_code" }, 400);
      }

      const otpHash = await sha256Hex(`${userId}:${email}:${code}`);
      const { data, error } = await adminClient.rpc("cleaner_city_verify_work_email_otp_hash", {
        p_user_id: userId,
        p_email: email,
        p_otp_hash: otpHash,
      });

      if (error) {
        const msg = error.message || "Verification failed";
        const lower = msg.toLowerCase();
        if (lower.includes("expired")) {
          return json({ error: "Code expired. Send a new code.", code: "otp_expired" }, 400);
        }
        if (lower.includes("attempt") || lower.includes("invalid")) {
          return json({ error: "Incorrect code. Check your email and try again.", code: "otp_invalid" }, 400);
        }
        return json({ error: msg, code: "verify_failed" }, 400);
      }

      return json({ success: true, verification: data, badge: "Work email verified" });
    }

    const rl = await checkRateLimit(`cc-work-email-send:${userId}`, 5, 600);
    if (!rl.allowed) {
      return json({ error: "Too many codes sent. Wait a few minutes before trying again.", code: "rate_limited" }, 429);
    }

    let precheck: Record<string, unknown> | null = null;
    {
      const { data: checkData, error: checkErr } = await adminClient.rpc(
        "cleaner_city_check_work_email_domain",
        { p_email: email },
      );
      if (!checkErr && checkData && typeof checkData === "object") {
        precheck = checkData as Record<string, unknown>;
        if (precheck.ok === false) {
          return json(
            {
              error: String(precheck.message || "Email domain not allowed"),
              code: String(precheck.code || "domain_not_approved"),
              domain: precheck.domain ?? null,
            },
            400,
          );
        }
      }
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
      const mapped = mapStoreError(storeError.message || "");
      return json(mapped, 400);
    }

    const apiKey = await getCredential(adminClient, "resend_api_key", "RESEND_API_KEY");
    const from =
      (await getCredential(adminClient, "resend_from_email", "RESEND_FROM_EMAIL")) ||
      "Sociva <onboarding@resend.dev>";

    if (!apiKey) {
      return json(
        {
          error:
            "Email provider is not configured yet. Ask an admin to set the Resend API key before sending work-email codes.",
          code: "email_provider_missing",
        },
        503,
      );
    }

    const sent = await sendResendEmail({ apiKey, to: email, code: otp, from });
    if (!sent.ok) {
      const mapped = mapResendError(sent.status || 502, sent.body || "");
      console.error("[cleaner-city-work-email-otp] resend", sent.status, sent.body);
      return json(mapped, 502);
    }

    return json({
      success: true,
      message: "Verification code sent to your work email",
      expires_at: expiresAt,
      domain: precheck?.domain ?? email.split("@")[1],
    });
  } catch (e) {
    console.error("[cleaner-city-work-email-otp]", e);
    return json({ error: "Something went wrong sending the code. Please try again.", code: "unexpected" }, 500);
  }
});
