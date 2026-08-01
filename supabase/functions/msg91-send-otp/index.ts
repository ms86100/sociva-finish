import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Shared across warm isolates — avoid re-querying admin_settings on every OTP
let _admin: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (!_admin) {
    _admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _admin;
}

type Msg91Creds = { authKey: string; widgetId: string; tokenAuth: string; fetchedAt: number };
let _credsCache: Msg91Creds | null = null;
const CREDS_TTL_MS = 10 * 60 * 1000;
const CREDS_DB_TIMEOUT_MS = 4_000;
const RATE_LIMIT_TIMEOUT_MS = 3_000;
const MSG91_TIMEOUT_MS = 12_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getMsg91Creds(): Promise<Msg91Creds | null> {
  if (_credsCache && Date.now() - _credsCache.fetchedAt < CREDS_TTL_MS) {
    return _credsCache;
  }

  // Prefer env secrets when all three are set (zero DB RTT)
  const envAuth = Deno.env.get("MSG91_AUTH_KEY");
  const envWidget = Deno.env.get("MSG91_WIDGET_ID");
  const envToken = Deno.env.get("MSG91_TOKEN_AUTH");
  if (envAuth && envWidget && envToken) {
    _credsCache = { authKey: envAuth, widgetId: envWidget, tokenAuth: envToken, fetchedAt: Date.now() };
    return _credsCache;
  }

  // Single query for all keys (was 3 round-trips) — bounded so DB overload can't hang the worker
  const { data: rows } = await withTimeout(
    Promise.resolve(
      getAdmin()
        .from("admin_settings")
        .select("key, value, is_active")
        .in("key", ["msg91_auth_key", "msg91_widget_id", "msg91_token_auth"]),
    ) as Promise<{ data: Array<{ key: string; value: string; is_active: boolean | null }> | null }>,
    CREDS_DB_TIMEOUT_MS,
    "msg91-creds-db",
  );

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    if (r.value && r.is_active !== false) map[r.key] = r.value;
  }

  const authKey = map.msg91_auth_key || envAuth || "";
  const widgetId = map.msg91_widget_id || envWidget || "";
  const tokenAuth = map.msg91_token_auth || envToken || "";
  if (!authKey || !widgetId || !tokenAuth) return null;

  _credsCache = { authKey, widgetId, tokenAuth, fetchedAt: Date.now() };
  return _credsCache;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const { phone, country_code = "91", resend = false, reqId } = await req.json();
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (resend && !reqId) {
      return new Response(
        JSON.stringify({ error: "Missing request ID for resend" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!resend) {
      if (!phone || !/^\d{10}$/.test(phone)) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number. Please provide a 10-digit number." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (phone === "0123456789" && country_code === "91") {
        return new Response(
          JSON.stringify({ success: true, message: "OTP sent", reqId: "apple-review-bypass" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // One rate-limit key (was 2 sequential DB round-trips) + creds in parallel
    const rlKey = resend
      ? `otp-send-ip:${clientIp}`
      : `otp-send:${country_code}${phone}:${clientIp}`;

    const [credsResult, rlResult] = await Promise.allSettled([
      getMsg91Creds(),
      withTimeout(
        checkRateLimit(rlKey, resend ? 20 : 8, 600),
        RATE_LIMIT_TIMEOUT_MS,
        "otp-rate-limit",
      ),
    ]);

    // Rate limiter already allows on internal errors; treat timeout the same way
    const rl =
      rlResult.status === "fulfilled"
        ? rlResult.value
        : { allowed: true, remaining: resend ? 20 : 8 };
    if (rlResult.status === "rejected") {
      console.warn("[msg91-send-otp] rate limit timed out; allowing:", rlResult.reason);
    }
    if (!rl.allowed) return rateLimitResponse(corsHeaders);

    const creds = credsResult.status === "fulfilled" ? credsResult.value : null;
    if (credsResult.status === "rejected") {
      console.error("[msg91-send-otp] creds fetch failed:", credsResult.reason);
    }
    if (!creds) {
      console.error("MSG91 Widget credentials not configured (checked DB + env)");
      return new Response(
        JSON.stringify({ error: "OTP service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tCreds = Date.now();
    let data: any;
    const msg91Signal = AbortSignal.timeout(MSG91_TIMEOUT_MS);

    if (resend) {
      const retryRes = await fetch("https://api.msg91.com/api/v5/widget/retryOtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reqId,
          retryChannel: 11,
          authkey: creds.authKey,
          widgetId: creds.widgetId,
          tokenAuth: creds.tokenAuth,
        }),
        signal: msg91Signal,
      });
      data = await retryRes.json();
    } else {
      const identifier = `${country_code}${phone}`;
      const sendRes = await fetch("https://api.msg91.com/api/v5/widget/sendOtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          widgetId: creds.widgetId,
          tokenAuth: creds.tokenAuth,
          authkey: creds.authKey,
        }),
        signal: msg91Signal,
      });
      data = await sendRes.json();
    }

    console.log(
      `[msg91-send-otp] setup=${tCreds - t0}ms msg91=${Date.now() - tCreds}ms total=${Date.now() - t0}ms resend=${resend} type=${data?.type}`,
    );

    if (data.type === "success") {
      return new Response(
        JSON.stringify({
          success: true,
          message: resend ? "OTP resent" : "OTP sent",
          reqId: data.reqId || data.message || reqId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.error("MSG91 Widget OTP failed:", JSON.stringify(data));
    return new Response(
      JSON.stringify({ error: data.message || "Failed to send OTP. Please try again." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = String((error as Error)?.message || error || "");
    const timedOut =
      (error as Error)?.name === "TimeoutError" ||
      (error as Error)?.name === "AbortError" ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("aborted");
    console.error("Send OTP error:", error);
    return new Response(
      JSON.stringify({
        error: timedOut
          ? "OTP service is slow right now. Please try again."
          : "Internal server error",
      }),
      { status: timedOut ? 504 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
