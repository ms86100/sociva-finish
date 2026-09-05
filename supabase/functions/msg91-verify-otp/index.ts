import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { checkRateLimit } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Shared across warm isolates
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
const AUTH_LOOKUP_TIMEOUT_MS = 5_000;
const AUTH_ADMIN_TIMEOUT_MS = 8_000;

function getFriendlyError(code?: number, message?: string): string {
  if (code === 703 || message?.includes("already verif")) return "This OTP has already been used. Please request a new one.";
  if (code === 705 || message?.includes("invalid otp")) return "Incorrect OTP. Please check the code and try again.";
  if (code === 706 || message?.includes("expired")) return "OTP has expired. Please request a new one.";
  if (code === 707 || message?.includes("max attempt")) return "Too many attempts. Please request a new OTP.";
  if (message?.includes("mobile not found")) return "Phone number not found. Please go back and re-enter your number.";
  return "Verification failed. Please request a new OTP and try again.";
}

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

  const envAuth = Deno.env.get("MSG91_AUTH_KEY");
  const envWidget = Deno.env.get("MSG91_WIDGET_ID");
  const envToken = Deno.env.get("MSG91_TOKEN_AUTH");
  if (envAuth && envWidget && envToken) {
    _credsCache = { authKey: envAuth, widgetId: envWidget, tokenAuth: envToken, fetchedAt: Date.now() };
    return _credsCache;
  }

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

/** Fast path: profiles table (indexed). Auth listUsers only as fallback. */
async function lookupExistingUser(
  admin: ReturnType<typeof createClient>,
  syntheticEmail: string,
  mobile: string,
  fullPhone: string,
  /** 10-digit national number, e.g. 9876543201 — profiles often store this without +91 */
  nationalPhone: string,
): Promise<{ id: string; email: string } | null> {
  try {
    // Match common phone storage formats: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX
    const phoneOr = [
      `email.eq."${syntheticEmail}"`,
      `phone.eq."${fullPhone}"`,
      `phone.eq."${mobile}"`,
      `phone.eq."${nationalPhone}"`,
    ].join(",");
    const { data: profs } = await withTimeout(
      Promise.resolve(
        admin
          .from("profiles")
          .select("id, email, phone, created_at")
          .or(phoneOr)
          .order("created_at", { ascending: true })
          .limit(5),
      ) as Promise<{ data: { id: string; email: string | null; phone: string | null; created_at?: string }[] | null }>,
      AUTH_LOOKUP_TIMEOUT_MS,
      "profile-lookup",
    );
    if (profs?.length) {
      // Prefer an existing admin profile when duplicate phone formats exist
      const { data: adminRoles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .in(
          "user_id",
          profs.map((p) => p.id),
        );
      const adminIds = new Set((adminRoles || []).map((r: { user_id: string }) => r.user_id));
      const preferred = profs.find((p) => adminIds.has(p.id)) || profs[0];
      // CRITICAL: magic-link session email must come from auth.users, never profiles.email.
      // profiles.email can be a personal Gmail that belongs to a *different* GoTrue user
      // (e.g. phone account 6b7d… has profile email ms86100@gmail.com → wrong session, no phone/admin).
      let authEmail = syntheticEmail;
      try {
        const { data: authRow } = await admin.auth.admin.getUserById(preferred.id);
        if (authRow?.user?.email) authEmail = authRow.user.email;
      } catch (e) {
        console.warn("getUserById for session email failed:", e);
      }
      return { id: preferred.id, email: authEmail };
    }
  } catch (e) {
    console.warn("profile lookup error:", e);
  }

  // Fallback: GoTrue admin filter (slower; rare when profile missing)
  try {
    const [byEmail, byPhone] = await withTimeout(
      Promise.all([
        (admin.auth.admin as any).listUsers({ page: 1, perPage: 1, filter: `email.eq.${syntheticEmail}` }),
        (admin.auth.admin as any).listUsers({ page: 1, perPage: 1, filter: `phone.eq.${mobile}` }),
      ]),
      AUTH_LOOKUP_TIMEOUT_MS,
      "auth-listUsers",
    );
    const emailUser = byEmail?.data?.users?.find((u: any) => u.email === syntheticEmail);
    if (emailUser) return { id: emailUser.id, email: emailUser.email || syntheticEmail };
    const phoneUser = byPhone?.data?.users?.find(
      (u: any) => u.phone === mobile || u.phone === fullPhone,
    );
    if (phoneUser) return { id: phoneUser.id, email: phoneUser.email || syntheticEmail };
  } catch (e) {
    console.warn("auth lookup error:", e);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const { reqId, otp, phone, country_code = "91" } = await req.json();
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (!reqId) {
      return new Response(JSON.stringify({ error: "Please go back and re-enter your phone number." }), { status: 400, headers: jsonHeaders });
    }
    if (!otp || !/^\d{4,6}$/.test(otp)) {
      return new Response(JSON.stringify({ error: "Please enter a valid 4-digit OTP." }), { status: 400, headers: jsonHeaders });
    }
    if (!phone || !/^\d{10}$/.test(phone)) {
      return new Response(JSON.stringify({ error: "Invalid phone number." }), { status: 400, headers: jsonHeaders });
    }

    const isAppleReviewBypass =
      (phone === "0123456789" ||
        phone === "0987654321" ||
        phone === "9876543201" ||
        phone === "9535115316") && // TEMP E2E — remove after seller session
      reqId === "apple-review-bypass" &&
      otp === "1234";
    const mobile = `${country_code}${phone}`;
    const fullPhone = `+${mobile}`;
    const syntheticEmail = `${mobile}@phone.sociva.app`;
    const admin = getAdmin();
    let authUser: { id: string; email: string } | null = null;

    // ─── Setup: one rate-limit key + creds (skip MSG91 creds for Apple bypass) ───
    const rlKey = `otp-verify:${reqId}:${clientIp}`;

    if (!isAppleReviewBypass) {
      const [credsResult, rlResult] = await Promise.allSettled([
        getMsg91Creds(),
        withTimeout(checkRateLimit(rlKey, 12, 600), RATE_LIMIT_TIMEOUT_MS, "otp-verify-rate-limit"),
      ]);

      const rl =
        rlResult.status === "fulfilled"
          ? rlResult.value
          : { allowed: true, remaining: 12 };
      if (rlResult.status === "rejected") {
        console.warn("[msg91-verify-otp] rate limit timed out; allowing:", rlResult.reason);
      }
      if (!rl.allowed) {
        return new Response(
          JSON.stringify({ error: "Too many verification attempts. Please request a new OTP." }),
          { status: 429, headers: jsonHeaders },
        );
      }

      const creds = credsResult.status === "fulfilled" ? credsResult.value : null;
      if (credsResult.status === "rejected") {
        console.error("[msg91-verify-otp] creds fetch failed:", credsResult.reason);
      }
      if (!creds) {
        return new Response(
          JSON.stringify({ error: "OTP service is temporarily unavailable. Please try again later." }),
          { status: 500, headers: jsonHeaders },
        );
      }

      const tSetup = Date.now();

      // ─── MSG91 verify + user lookup in parallel (lookup is read-only) ───
      const msg91Signal = AbortSignal.timeout(MSG91_TIMEOUT_MS);
      const [verifyOutcome, lookupOutcome] = await Promise.allSettled([
        (async () => {
          const verifyRes = await fetch("https://api.msg91.com/api/v5/widget/verifyOtp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reqId,
              otp,
              widgetId: creds.widgetId,
              tokenAuth: creds.tokenAuth,
              authkey: creds.authKey,
            }),
            signal: msg91Signal,
          });
          return await verifyRes.json();
        })(),
        lookupExistingUser(admin, syntheticEmail, mobile, fullPhone, phone),
      ]);

      if (verifyOutcome.status === "rejected") {
        const msg = String(verifyOutcome.reason?.message || verifyOutcome.reason || "");
        const timedOut =
          verifyOutcome.reason?.name === "TimeoutError" ||
          verifyOutcome.reason?.name === "AbortError" ||
          msg.toLowerCase().includes("timed out") ||
          msg.toLowerCase().includes("aborted");
        console.error("[msg91-verify-otp] MSG91 failed:", verifyOutcome.reason);
        return new Response(
          JSON.stringify({
            error: timedOut
              ? "Verification is slow right now. Please try again."
              : "Something went wrong. Please try again.",
          }),
          { status: timedOut ? 504 : 500, headers: jsonHeaders },
        );
      }

      const verifyData = verifyOutcome.value;
      console.log(
        `[msg91-verify-otp] setup=${tSetup - t0}ms msg91+lookup=${Date.now() - tSetup}ms type=${verifyData?.type} code=${verifyData?.code}`,
      );

      if (verifyData.type !== "success") {
        return new Response(
          JSON.stringify({ error: getFriendlyError(verifyData.code, verifyData.message) }),
          { status: 400, headers: jsonHeaders },
        );
      }

      authUser = lookupOutcome.status === "fulfilled" ? lookupOutcome.value : null;
      if (lookupOutcome.status === "rejected") {
        console.warn("[msg91-verify-otp] lookup failed:", lookupOutcome.reason);
      }
    } else {
      console.log("Apple reviewer bypass — skipping MSG91 verification for demo phone");
      // Light rate limit only; no MSG91 creds needed
      try {
        await withTimeout(checkRateLimit(rlKey, 12, 600), RATE_LIMIT_TIMEOUT_MS, "otp-verify-rate-limit");
      } catch {
        /* allow */
      }
      authUser = await lookupExistingUser(admin, syntheticEmail, mobile, fullPhone, phone);
    }

    // ─── Find or create Supabase user ───
    // Source of truth for session email = synthetic email / auth email.
    // Profile is a fast hint only; auth create/generateLink remains authoritative.
    let isNewUser = false;
    let userEmail = syntheticEmail;
    let userId: string | null = null;

    if (authUser) {
      userId = authUser.id;
      // ALWAYS magic-link the phone synthetic email — never auth.users.email nor profiles.email.
      // Personal Gmail on a phone profile previously signed users into a different GoTrue account
      // (no phone, no admin) while they thought they logged in with OTP.
      userEmail = syntheticEmail;
      console.log("Found existing user:", userId, "sessionEmail:", userEmail);
      // MUST complete before generateLink — fire-and-forget left first login racing
      // (auth.users still on old email → magiclink token / session mismatch).
      try {
        await withTimeout(
          admin.auth.admin.updateUserById(userId, {
            email: syntheticEmail,
            email_confirm: true,
            phone: fullPhone,
            phone_confirm: true,
          }),
          AUTH_ADMIN_TIMEOUT_MS,
          "updateUserEmail",
        );
      } catch (e) {
        console.warn("auth phone/email self-heal failed (continuing):", e);
      }
      void admin.from("profiles").update({ phone: fullPhone }).eq("id", userId);
    } else {
      isNewUser = true;
      const createResult = await withTimeout(
        admin.auth.admin.createUser({
          email: syntheticEmail,
          phone: fullPhone,
          phone_confirm: true,
          email_confirm: true,
          user_metadata: { phone: fullPhone, name: "User" },
        }),
        AUTH_ADMIN_TIMEOUT_MS,
        "createUser",
      );

      const { data: newUser, error: createError } = createResult;

      if (createError) {
        if (
          createError.message?.includes("already") ||
          createError.message?.includes("duplicate") ||
          (createError as any).code === "email_exists"
        ) {
          console.log("Create raced — user already exists, treating as existing");
          isNewUser = false;
          userEmail = syntheticEmail;
          // Resolve id so we can still align email before generateLink
          const raced = await lookupExistingUser(admin, syntheticEmail, mobile, fullPhone, phone);
          if (raced?.id) {
            userId = raced.id;
            try {
              await withTimeout(
                admin.auth.admin.updateUserById(userId, {
                  email: syntheticEmail,
                  email_confirm: true,
                  phone: fullPhone,
                  phone_confirm: true,
                }),
                AUTH_ADMIN_TIMEOUT_MS,
                "updateUserEmail-race",
              );
            } catch (e) {
              console.warn("race email heal failed:", e);
            }
          }
        } else {
          console.error("Create user error:", createError);
          return new Response(
            JSON.stringify({ error: "Account setup failed. Please try again." }),
            { status: 500, headers: jsonHeaders },
          );
        }
      } else if (newUser?.user) {
        userId = newUser.user.id;
        const [profileRes, roleRes] = await Promise.all([
          admin.from("profiles").upsert(
            {
              id: userId,
              email: syntheticEmail,
              phone: fullPhone,
              name: "User",
              flat_number: "",
              block: "",
              browse_beyond_community: true,
            },
            { onConflict: "id" },
          ),
          admin.from("user_roles").insert({ user_id: userId, role: "buyer" }),
        ]);
        if (profileRes.error) console.warn("Profile upsert warning:", profileRes.error.message);
        if (roleRes.error && !roleRes.error.message?.includes("duplicate")) {
          console.warn("Role insert warning:", roleRes.error.message);
        }
        console.log("Created new user:", userId);
      }
    }

    // ─── Mint session server-side (avoid client verifyOtp wasting a consumed MSG91 OTP) ───
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let tokenHash: string | null = null;
    let lastLinkError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: linkData, error: linkError } = await withTimeout(
        admin.auth.admin.generateLink({ type: "magiclink", email: userEmail }),
        AUTH_ADMIN_TIMEOUT_MS,
        "generateLink",
      );

      if (linkError || !linkData?.properties?.hashed_token) {
        lastLinkError = linkError;
        console.error("Generate link error:", linkError);
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }

      tokenHash = linkData.properties.hashed_token as string;

      // Exchange token_hash for a real session using GoTrue verify (service role).
      try {
        const verifyRes = await withTimeout(
          fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/verify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
            body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
          }),
          AUTH_ADMIN_TIMEOUT_MS,
          "gotrue-verify",
        );
        const verifyJson: any = await verifyRes.json().catch(() => ({}));
        if (
          verifyRes.ok &&
          verifyJson?.access_token &&
          verifyJson?.refresh_token
        ) {
          accessToken = verifyJson.access_token;
          refreshToken = verifyJson.refresh_token;
          break;
        }
        console.warn(
          "[msg91-verify-otp] gotrue verify failed:",
          verifyRes.status,
          verifyJson?.error_description || verifyJson?.msg || verifyJson?.error,
        );
      } catch (e) {
        console.warn("[msg91-verify-otp] gotrue verify error:", e);
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }

    if (!accessToken || !refreshToken) {
      console.error("Session mint failed after OTP verify. lastLinkError:", lastLinkError);
      // Still return token_hash as fallback for client verifyOtp — better than hard fail
      // if GoTrue verify endpoint shape differs by version.
      if (tokenHash) {
        console.log(`[msg91-verify-otp] total=${Date.now() - t0}ms isNew=${isNewUser} fallback=token_hash`);
        return new Response(
          JSON.stringify({
            success: true,
            token_hash: tokenHash,
            is_new_user: isNewUser,
            session_mint: "client",
          }),
          { headers: jsonHeaders },
        );
      }
      return new Response(
        JSON.stringify({
          error:
            "Phone verified, but sign-in timed out. Please request a new OTP and try again.",
        }),
        { status: 503, headers: jsonHeaders },
      );
    }

    console.log(`[msg91-verify-otp] total=${Date.now() - t0}ms isNew=${isNewUser} session=minted`);

    return new Response(
      JSON.stringify({
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_hash: tokenHash,
        is_new_user: isNewUser,
        session_mint: "server",
      }),
      { headers: jsonHeaders },
    );
  } catch (error) {
    const msg = String((error as Error)?.message || error || "");
    const timedOut =
      (error as Error)?.name === "TimeoutError" ||
      (error as Error)?.name === "AbortError" ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("aborted");
    console.error("Verify OTP error:", error);
    return new Response(
      JSON.stringify({
        error: timedOut
          ? "Verification is slow right now. Please try again."
          : "Something went wrong. Please try again.",
      }),
      { status: timedOut ? 504 : 500, headers: jsonHeaders },
    );
  }
});
