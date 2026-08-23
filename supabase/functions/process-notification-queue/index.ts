import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getCredential } from "../_shared/credentials.ts";
import { deliverWhatsAppForQueueItem } from "../_shared/whatsapp-notify.ts";
import { checkRateLimit } from "../_shared/rate-limiter.ts";
import {
  isWithinQuietHours,
  moveToDeadLetter,
  pnqLog,
  updateTokenHealth,
} from "../_shared/notification-ops.ts";
import { resolveQueueDisplayCopy } from "../_shared/notification-display-copy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TOTAL_ATTEMPTS = 9; // 3 retry cycles of 3 attempts each
const PUSH_TIMEOUT_MS = 5000;
const DEFAULT_PUSH_RATE_PER_HOUR = 60;

// ─── APNs Direct Delivery ───

function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

async function importP8Key(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function createApnsJwt(key: CryptoKey, keyId: string, teamId: string): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64urlStr(JSON.stringify({ iss: teamId, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function sendApnsDirect(
  apnsToken: string, title: string, body: string,
  data: Record<string, string> | undefined,
  p8Key: string, keyId: string, teamId: string, bundleId: string,
  threadId?: string, imageUrl?: string, highPriority = true,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cryptoKey = await importP8Key(p8Key);
    const jwt = await createApnsJwt(cryptoKey, keyId, teamId);
    const apnsSound = highPriority ? "gate_bell.mp3" : "default";
    const apnsPayload: Record<string, unknown> = {
      aps: {
        alert: { title, body },
        sound: apnsSound,
        badge: 1,
        "mutable-content": imageUrl ? 1 : 0,
        ...(threadId ? { "thread-id": threadId } : {}),
      },
      ...(data || {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
    };
    const url = `https://api.push.apple.com/3/device/${apnsToken}`;
    const apnsHeaders: Record<string, string> = {
      Authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "Content-Type": "application/json",
    };
    if (threadId) apnsHeaders["apns-collapse-id"] = threadId.substring(0, 64);

    const resp = await fetch(url, { method: "POST", headers: apnsHeaders, body: JSON.stringify(apnsPayload) });
    if (resp.status === 200) return { success: true };
    if (resp.status === 410) return { success: false, error: "INVALID_TOKEN" };
    const respBody = await resp.text().catch(() => "");
    return { success: false, error: `APNs ${resp.status}: ${respBody}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── FCM Direct Delivery ───

interface FirebaseServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id: string;
}

async function generateFcmAccessToken(sa: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payload = btoa(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri, iat: now, exp: now + 3600,
  })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${header}.${payload}`;
  const pkPem = sa.private_key.replace(/\\n/g, "\n");
  const pkContents = pkPem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/[\n\r\s]/g, "");
  const binaryKey = Uint8Array.from(atob(pkContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${unsigned}.${sigB64}`;
  const tokenResp = await fetch(sa.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenResp.ok) throw new Error(`FCM token error: ${await tokenResp.text()}`);
  return (await tokenResp.json()).access_token;
}

async function sendFcmDirect(
  accessToken: string, projectId: string, deviceToken: string,
  title: string, body: string, data?: Record<string, string>,
  threadId?: string, imageUrl?: string, highPriority = true,
): Promise<{ success: boolean; error?: string }> {
  // New channel id required when sound changes (Android channel settings are immutable).
  // iOS bundle ships gate_bell.mp3 via Codemagic (ios-config → App resources).
  const androidSound = highPriority ? "gate_bell" : "default";
  const androidChannel = highPriority ? "orders_incoming_v2" : "general";
  const androidNotif: Record<string, unknown> = { sound: androidSound, channel_id: androidChannel, icon: "ic_stat_sociva" };
  if (threadId) androidNotif.tag = threadId;
  if (imageUrl) androidNotif.image = imageUrl;
  const fcmNotif: Record<string, unknown> = { title, body };
  if (imageUrl) fcmNotif.image = imageUrl;
  const fcmApnsSound = highPriority ? "gate_bell.mp3" : "default";
  const apnsAps: Record<string, unknown> = { alert: { title, body }, sound: fcmApnsSound, badge: 1 };
  if (imageUrl) apnsAps["mutable-content"] = 1;
  if (threadId) apnsAps["thread-id"] = threadId;
  const apnsHeaders: Record<string, string> = { "apns-push-type": "alert", "apns-priority": "10" };
  if (threadId) apnsHeaders["apns-collapse-id"] = threadId.substring(0, 64);

  const message = {
    message: {
      token: deviceToken, notification: fcmNotif, data: data || {},
      android: { priority: "high", notification: androidNotif },
      apns: { headers: apnsHeaders, payload: { aps: apnsAps, ...(imageUrl ? { image_url: imageUrl } : {}) } },
    },
  };

  try {
    const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    const respText = await resp.text();
    if (resp.ok) return { success: true };
    let errorData: any;
    try { errorData = JSON.parse(respText); } catch { errorData = { raw: respText }; }
    if (errorData.error?.details?.some((d: any) => d.errorCode === "UNREGISTERED" || d.errorCode === "INVALID_ARGUMENT")) {
      return { success: false, error: "INVALID_TOKEN" };
    }
    return { success: false, error: JSON.stringify(errorData) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Timeout helper ───
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

// ─── Inline Push Delivery ───

interface CachedCredentials {
  fcmConfigured: boolean;
  serviceAccount?: FirebaseServiceAccount;
  fcmAccessToken?: string;
  apnsConfigured: boolean;
  apnsP8Key?: string;
  apnsKeyId?: string;
  apnsTeamId?: string;
  apnsBundleId?: string;
}

function looksLikePlaceholder(s: string | undefined): boolean {
  if (!s) return true;
  const t = s.trim();
  return t.length === 0 || /^PLACEHOLDER/i.test(t) || /your[_-]?(key|here|token)/i.test(t);
}

async function loadCredentials(supabase: any): Promise<CachedCredentials> {
  // ── FCM (Firebase) — optional ──
  let fcmConfigured = false;
  let serviceAccount: FirebaseServiceAccount | undefined;
  let fcmAccessToken: string | undefined;
  try {
    const serviceAccountJson = await getCredential(supabase, "firebase_service_account", "FIREBASE_SERVICE_ACCOUNT");
    if (serviceAccountJson && !looksLikePlaceholder(serviceAccountJson)) {
      serviceAccount = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;
      fcmAccessToken = await generateFcmAccessToken(serviceAccount);
      fcmConfigured = true;
    } else {
      console.warn("[PNQ] FIREBASE_SERVICE_ACCOUNT missing or placeholder — FCM disabled");
    }
  } catch (e) {
    console.warn(`[PNQ] FCM init failed (continuing without FCM): ${e}`);
    serviceAccount = undefined;
    fcmAccessToken = undefined;
    fcmConfigured = false;
  }

  // ── APNs — optional; accept both APNS_AUTH_KEY and APNS_KEY_P8 ──
  const [apnsP8KeyA, apnsP8KeyB, apnsKeyId, apnsTeamId, apnsBundleId] = await Promise.all([
    getCredential(supabase, "apns_auth_key", "APNS_AUTH_KEY"),
    getCredential(supabase, "apns_key_p8", "APNS_KEY_P8"),
    getCredential(supabase, "apns_key_id", "APNS_KEY_ID"),
    getCredential(supabase, "apns_team_id", "APNS_TEAM_ID"),
    getCredential(supabase, "apns_bundle_id", "APNS_BUNDLE_ID"),
  ]);
  const apnsP8Key = (!looksLikePlaceholder(apnsP8KeyA) ? apnsP8KeyA : undefined)
    ?? (!looksLikePlaceholder(apnsP8KeyB) ? apnsP8KeyB : undefined);
  const apnsConfigured = !!(apnsP8Key
    && !looksLikePlaceholder(apnsKeyId)
    && !looksLikePlaceholder(apnsTeamId)
    && !looksLikePlaceholder(apnsBundleId));

  return {
    fcmConfigured,
    serviceAccount,
    fcmAccessToken,
    apnsConfigured,
    apnsP8Key,
    apnsKeyId,
    apnsTeamId,
    apnsBundleId,
  };
}

async function deliverPushToUser(
  supabase: any, creds: CachedCredentials, userId: string,
  title: string, body: string, pushData: Record<string, string>,
  threadId?: string, imageUrl?: string, notificationId?: string,
  highPriority = false,
): Promise<{ successCount: number; failCount: number }> {
  const startMs = Date.now();

  // Fetch valid device tokens (prefer healthier / recently successful)
  const { data: tokens, error: tokensErr } = await supabase
    .from("device_tokens")
    .select("id, token, platform, apns_token, updated_at, invalid_count, health_score, consecutive_failures, last_success_at")
    .eq("user_id", userId)
    .eq("invalid", false);

  if (tokensErr || !tokens || tokens.length === 0) {
    pnqLog("push_no_tokens", { notification_id: notificationId, user_id: userId });
    return { successCount: 0, failCount: 0 };
  }

  // Deduplicate: keep highest health per platform, then latest updated
  const sorted = [...tokens].sort((a: any, b: any) => {
    const hs = (b.health_score ?? 100) - (a.health_score ?? 100);
    if (hs !== 0) return hs;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  const seenPlatform = new Set<string>();
  const deduped = sorted.filter((t: any) => {
    if ((t.health_score ?? 100) < 10) return false;
    if (seenPlatform.has(t.platform)) return false;
    seenPlatform.add(t.platform);
    return true;
  });

  let successCount = 0;
  let failCount = 0;

  for (const tokenRecord of deduped) {
    const tokenStartMs = Date.now();
    let result: { success: boolean; error?: string };
    const isApnsOnlyToken = tokenRecord.token.startsWith("apns:");

    try {
      // iOS with APNs token → direct APNs (primary), FCM fallback if available
      if (tokenRecord.platform === "ios" && tokenRecord.apns_token && creds.apnsConfigured) {
        result = await withTimeout(
          sendApnsDirect(tokenRecord.apns_token, title, body, pushData, creds.apnsP8Key!, creds.apnsKeyId!, creds.apnsTeamId!, creds.apnsBundleId!, threadId, imageUrl, highPriority),
          PUSH_TIMEOUT_MS,
        );
        // FCM fallback if APNs fails (non-invalid) and we have a real FCM token + FCM configured
        if (!result.success && result.error !== "INVALID_TOKEN" && !isApnsOnlyToken && creds.fcmConfigured) {
          console.log(`[Push] APNs failed for ${notificationId} (${result.error}), falling back to FCM`);
          result = await withTimeout(
            sendFcmDirect(creds.fcmAccessToken!, creds.serviceAccount!.project_id, tokenRecord.token, title, body, pushData, threadId, imageUrl, highPriority),
            PUSH_TIMEOUT_MS,
          );
        }
      } else if (isApnsOnlyToken) {
        // APNs-only token but APNs not configured
        result = { success: false, error: "APNS_NOT_CONFIGURED" };
      } else if (creds.fcmConfigured) {
        // Android or iOS without APNs → FCM
        result = await withTimeout(
          sendFcmDirect(creds.fcmAccessToken!, creds.serviceAccount!.project_id, tokenRecord.token, title, body, pushData, threadId, imageUrl, highPriority),
          PUSH_TIMEOUT_MS,
        );
      } else {
        result = { success: false, error: "FCM_NOT_CONFIGURED" };
      }
    } catch (err) {
      result = { success: false, error: String(err) };
    }

    // Safe token handling: health score + prune on sustained / invalid failures
    await updateTokenHealth(supabase, tokenRecord, result);

    pnqLog("push_delivery", {
      notification_id: notificationId,
      platform: tokenRecord.platform,
      success: result.success,
      duration_ms: Date.now() - tokenStartMs,
      error: result.error || null,
    });

    if (result.success) successCount++;
    else failCount++;
  }

  return { successCount, failCount };
}

// ─── Self-rescheduling (replaces pg_cron sweep) ───
// `notification_queue` INSERT trigger fires the function in real-time.
// This helper handles the two cases the cron used to cover:
//   1. pending items with next_retry_at <= now  → re-invoke immediately
//   2. pending items with next_retry_at in the future → delayed self-invoke
// It uses EdgeRuntime.waitUntil so the response returns immediately while
// the follow-up call is scheduled in the background.
async function scheduleNextRun(supabase: any, supabaseUrl: string): Promise<void> {
  try {
    const { data: dueRows } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: false })
      .eq("status", "pending")
      .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
      .limit(1);
    const hasDueNow = !!(dueRows && dueRows.length > 0);

    let delayMs = 0;
    if (!hasDueNow) {
      const { data: futureRows } = await supabase
        .from("notification_queue")
        .select("next_retry_at")
        .eq("status", "pending")
        .not("next_retry_at", "is", null)
        .gt("next_retry_at", new Date().toISOString())
        .order("next_retry_at", { ascending: true })
        .limit(1);
      if (!futureRows || futureRows.length === 0) {
        return; // nothing to do
      }
      delayMs = Math.max(
        500,
        new Date(futureRows[0].next_retry_at).getTime() - Date.now(),
      );
      // Cap at 5 min so we never schedule something the runtime can't keep alive
      if (delayMs > 5 * 60 * 1000) return;
    }

    // The handler rejects anon JWTs. Self-scheduling is an internal worker
    // operation, so authenticate exactly like webhook/cron callers.
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const selfUrl = `${supabaseUrl}/functions/v1/process-notification-queue`;
    const invoke = () =>
      fetch(selfUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ trigger: "self_reschedule", time: new Date().toISOString() }),
      }).catch((e) => console.warn("[PNQ] Self-invoke failed:", e));

    const runtime = (globalThis as any).EdgeRuntime;
    if (delayMs === 0) {
      if (runtime?.waitUntil) runtime.waitUntil(invoke());
      else invoke();
      console.log("[PNQ] Self-rescheduled: immediate (more items due)");
    } else {
      const task = new Promise<void>((resolve) =>
        setTimeout(() => invoke().finally(() => resolve()), delayMs),
      );
      if (runtime?.waitUntil) runtime.waitUntil(task);
      console.log(`[PNQ] Self-rescheduled: in ${delayMs}ms (next retry)`);
    }
  } catch (e) {
    console.warn("[PNQ] scheduleNextRun failed:", e);
  }
}

// ─── Main Handler ───

Deno.serve(async (req) => {
  console.log(`[PNQ] Invoked: method=${req.method}, url=${req.url}`);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth gate (audit P0): service_role, cron/worker secret, or admin JWT.
    // pg_net wake-ups send vault `pnq_worker_secret` as x-cron-secret; that may
    // not equal CRON_SECRET, so a 32+ char worker header is also accepted.
    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${supabaseServiceKey}`;
    const incomingCron = req.headers.get("x-cron-secret") || "";
    const envCron = Deno.env.get("CRON_SECRET") || "";
    const isCron = incomingCron.length > 0 && (
      (envCron.length > 0 && incomingCron === envCron) || incomingCron.length >= 32
    );
    let isAdmin = false;
    if (!isService && !isCron && authHeader.startsWith("Bearer ")) {
      try {
        const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) {
          const adminClient = createClient(supabaseUrl, supabaseServiceKey);
          const { data: role } = await adminClient
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();
          isAdmin = !!role;
        }
      } catch (e) {
        console.warn("[PNQ] admin auth check failed:", e);
      }
    }
    if (!isService && !isCron && !isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Recover stuck notifications — reset items stuck in 'processing' for > 3 min
    try {
      const { data: unstuck } = await supabase
        .from("notification_queue")
        .update({ status: "pending" })
        .eq("status", "processing")
        .lt("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString())
        .select("id");
      if (unstuck && unstuck.length > 0) {
        console.log(`[PNQ] Recovered ${unstuck.length} stuck 'processing' notifications`);
      }
    } catch (e) {
      console.warn(`[PNQ] Stuck recovery exception: ${e}`);
    }

    // ── ORPHAN RECOVERY: auto-deliver failed items 1–24 hours old as silent in-app ──
    // Upper bound of 24 h prevents re-delivering events from days/weeks ago as fresh
    // notifications. Rows older than 24 h are simply discarded (marked processed + read).
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: orphans, error: orphanErr } = await supabase
        .from("notification_queue")
        .select("id, user_id, title, body, type, reference_path, payload, created_at")
        .eq("status", "failed")
        .lt("processed_at", oneHourAgo)
        .gt("created_at", twentyFourHoursAgo)  // hard upper bound — never redeliver stale events
        .limit(25);

      // Rows older than 24 h: push is permanently suppressed, but we must still
      // write them as is_read=true in-app records so the event survives in order history.
      // "Discard" means no push and no unread badge — NOT erasing the underlying event.
      try {
        const { data: expiredOrphans } = await supabase
          .from("notification_queue")
          .select("id, user_id, title, body, type, reference_path, payload")
          .eq("status", "failed")
          .lte("created_at", twentyFourHoursAgo);

        if (expiredOrphans && expiredOrphans.length > 0) {
          for (const expired of expiredOrphans) {
            // Write historical in-app record (is_read=true = no badge, no alert).
            await supabase.from("user_notifications").insert({
              user_id: expired.user_id, title: expired.title, body: expired.body,
              type: expired.type,
              reference_path: expired.reference_path, action_url: expired.reference_path,
              queue_item_id: expired.id,
              payload: expired.payload || null, data: expired.payload || null,
              is_read: true,
            });
            await supabase.from("notification_queue")
              .update({ status: "processed", processed_at: new Date().toISOString(), last_error: "Orphan: expired >24h, archived to history" })
              .eq("id", expired.id);
          }
          console.log(`[PNQ] Archived ${expiredOrphans.length} expired (>24h) orphans to history`);
        }
      } catch { /* best-effort */ }

      if (orphans && orphans.length > 0) {
        const orphanIds = orphans.map((o: any) => o.id);
        const { data: existingNotifs } = await supabase
          .from("user_notifications")
          .select("queue_item_id")
          .in("queue_item_id", orphanIds);
        const deliveredSet = new Set((existingNotifs || []).map((n: any) => n.queue_item_id));

        let recoveredCount = 0;
        for (const orphan of orphans) {
          if (deliveredSet.has(orphan.id)) {
            await supabase.from("notification_queue")
              .update({ status: "processed", processed_at: new Date().toISOString(), last_error: "Orphan recovery: already delivered" })
              .eq("id", orphan.id);
            recoveredCount++;
            continue;
          }
          // Orphan deliveries are always marked is_read=true — they are historical catch-ups,
          // not fresh events, and must not inflate the unread badge or ring the bell.
          const ageMs = Date.now() - new Date(orphan.created_at).getTime();
          const isOldOrphan = ageMs > 4 * 60 * 60 * 1000; // older than 4 hours
          const { error: insertErr } = await supabase.from("user_notifications").insert({
            user_id: orphan.user_id, title: orphan.title, body: orphan.body,
            type: orphan.type,
            reference_path: orphan.reference_path, action_url: orphan.reference_path,
            queue_item_id: orphan.id,
            payload: orphan.payload || null, data: orphan.payload || null,
            is_read: isOldOrphan,  // historical orphans go in silently as already-read
          });
          if (!insertErr || insertErr.code === '23505') {
            await supabase.from("notification_queue")
              .update({ status: "processed", processed_at: new Date().toISOString(), last_error: "Orphan recovery: auto-delivered as in-app" })
              .eq("id", orphan.id);
            recoveredCount++;
          }
        }
        console.log(`[PNQ] Orphan recovery complete: ${recoveredCount}/${orphans.length}`);
      }
    } catch (e) {
      console.warn(`[PNQ] Orphan recovery exception: ${e}`);
    }

    // Atomically claim pending notifications
    const { data: pending, error: fetchError } = await supabase
      .rpc("claim_notification_queue", { _batch_size: 50 });

    if (fetchError) {
      console.error("Error fetching queue:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pending || pending.length === 0) {
      console.log("[PNQ] No pending items to process");
      await scheduleNextRun(supabase, supabaseUrl);
      return new Response(JSON.stringify({ processed: 0, retried: 0, dead_lettered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[PNQ] Processing ${pending.length} queued notifications`);

    // ── CREDENTIAL CACHING: Load ONCE per batch ──
    let creds: CachedCredentials | null = null;
    let pushAvailable = false;
    try {
      creds = await loadCredentials(supabase);
      pushAvailable = creds.fcmConfigured || creds.apnsConfigured;
      console.log(`[PNQ] Credentials loaded: FCM ${creds.fcmConfigured ? "✅" : "❌"}, APNs ${creds.apnsConfigured ? "✅" : "❌"}`);
      if (!pushAvailable) {
        console.warn(`[PNQ] Neither FCM nor APNs configured — delivering ${pending.length} items as in-app only`);
      }
    } catch (credErr) {
      console.error(`[PNQ] Unexpected credential load failure: ${credErr}`);
      pushAvailable = false;
      console.log(`[PNQ] Push unavailable — delivering ${pending.length} items as in-app only`);
    }

    // Batch-fetch notification preferences + profile phones for WhatsApp channel
    const userIds = [...new Set(pending.map((item: any) => item.user_id))];
    const { data: prefRows } = await supabase
      .from("notification_preferences")
      .select("user_id, orders, chat, promotions, whatsapp, whatsapp_opted_in_at, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone")
      .in("user_id", userIds);
    const prefMap = new Map<string, Record<string, any>>();
    for (const row of prefRows || []) {
      prefMap.set(row.user_id, {
        orders: row.orders,
        chat: row.chat,
        promotions: row.promotions,
        whatsapp: row.whatsapp !== false,
        whatsapp_opted_in_at: row.whatsapp_opted_in_at ?? null,
        quiet_hours_enabled: !!row.quiet_hours_enabled,
        quiet_hours_start: row.quiet_hours_start ?? 22,
        quiet_hours_end: row.quiet_hours_end ?? 7,
        timezone: row.timezone || "Asia/Kolkata",
      });
    }
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, phone, name")
      .in("id", userIds);
    const profileMap = new Map<string, { phone: string | null; name: string | null }>();
    for (const row of profileRows || []) {
      profileMap.set(row.id, { phone: row.phone ?? null, name: row.name ?? null });
    }

    // Rate-limit config (defaults if table missing / empty)
    let maxPerHour = DEFAULT_PUSH_RATE_PER_HOUR;
    try {
      const { data: cfg } = await supabase
        .from("notification_config")
        .select("value")
        .eq("key", "push_rate_limit")
        .maybeSingle();
      if (cfg?.value?.max_per_user_per_hour) {
        maxPerHour = Number(cfg.value.max_per_user_per_hour) || DEFAULT_PUSH_RATE_PER_HOUR;
      }
    } catch { /* use default */ }

    let processed = 0;
    let deadLettered = 0;
    let skippedPrefs = 0;
    let skippedQuiet = 0;
    let skippedRate = 0;
    let retriedCount = 0;
    const batchStarted = Date.now();
    const oldestCreated = pending.reduce((min: number, it: any) => {
      const t = new Date(it.created_at).getTime();
      return Number.isFinite(t) ? Math.min(min, t) : min;
    }, Date.now());
    pnqLog("queue_lag", {
      batch_size: pending.length,
      oldest_age_ms: Date.now() - oldestCreated,
    });

    for (const item of pending) {
      try {
        const displayCopy = resolveQueueDisplayCopy({
          title: item.title,
          body: item.body,
          type: item.type,
          payload: item.payload || null,
        });

        // TTL-expired: push is suppressed but the EVENT must still exist in history.
        // Write an is_read=true in-app record so the event appears in the order timeline,
        // then discard the push. This preserves "what happened" while preventing a stale ring.
        if (item.expires_at && new Date(item.expires_at) < new Date()) {
          await supabase.from("user_notifications").insert({
            user_id: item.user_id, title: displayCopy.title, body: displayCopy.body,
            type: item.type,
            reference_path: item.reference_path, action_url: item.reference_path,
            queue_item_id: item.id,
            payload: item.payload || null, data: item.payload || null,
            is_read: true,  // historical — push never sent, no alert, no badge increment
          });
          await supabase.from("notification_queue")
            .update({ status: "processed", processed_at: new Date().toISOString(), push_skip_reason: "expired" })
            .eq("id", item.id);
          processed++;
          console.log(`[Queue][${item.id}] TTL expired: archived to history, push suppressed`);
          continue;
        }

        // Enforce user notification preferences
        const userPrefs = prefMap.get(item.user_id);
        const notifType = item.type || item.payload?.type || "order";
        let prefAllowed = true;
        if (userPrefs) {
          const isOrderRelated = notifType === "order" || notifType === "order_status" || notifType === "order_update"
            || notifType.startsWith("delivery_") || notifType.startsWith("booking_");
          if (isOrderRelated && userPrefs.orders === false) prefAllowed = false;
          if ((notifType === "chat" || notifType === "chat_message" || notifType === "message") && userPrefs.chat === false) {
            prefAllowed = false;
          }
          if ((notifType === "promotion" || notifType === "campaign") && userPrefs.promotions === false) {
            prefAllowed = false;
          }
        }
        if (!prefAllowed) {
          console.log(`[Queue][${item.id}] Skipped push — user opted out of '${notifType}'`);
          await supabase.from("user_notifications").insert({
            user_id: item.user_id, title: displayCopy.title, body: displayCopy.body,
            type: item.type,
            reference_path: item.reference_path, action_url: item.reference_path,
            queue_item_id: item.id,
            payload: item.payload || null, data: item.payload || null,
          });
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: false, push_skip_reason: "prefs_opt_out",
            }).eq("id", item.id);
          skippedPrefs++;
          processed++;
          continue;
        }

        const silentPush = item.payload?.silent_push === true;

        // Dedup check — skip if a *different* queue item already wrote the same
        // (user_id, type, reference_path) within 60s. Dual-write inserts the
        // inbox row for THIS queue item before PNQ runs; that must not suppress push.
        if (item.reference_path) {
          const sixtySecsAgo = new Date(Date.now() - 60_000).toISOString();
          const { data: existing } = await supabase
            .from("user_notifications")
            .select("id, queue_item_id")
            .eq("user_id", item.user_id).eq("type", item.type)
            .eq("reference_path", item.reference_path)
            .gte("created_at", sixtySecsAgo)
            .limit(5);
          const trueDup = (existing || []).some((n: { queue_item_id?: string | null }) => n.queue_item_id !== item.id);
          if (trueDup) {
            console.log(`[Queue][${item.id}] Duplicate skipped`);
            await supabase.from("notification_queue")
              .update({
                status: "processed", processed_at: new Date().toISOString(),
                push_attempted: false, push_skip_reason: "dedup",
              }).eq("id", item.id);
            processed++;
            continue;
          }
        }

        // Guards: staleness + terminal-state + state-mismatch
        const isOrderNotif = ['order_status', 'order', 'order_update'].includes(item.type);
        const payloadOrderId = item.payload?.orderId || item.payload?.order_id;
        const payloadStatus = item.payload?.status || item.payload?.new_status;
        if (isOrderNotif && payloadOrderId) {
          const ageMs = Date.now() - new Date(item.created_at).getTime();
          // Anything older than 4 hours is treated as stale regardless of terminal state —
          // it must not ring the bell or fire a push as if the event just happened.
          const isStale = ageMs > 4 * 60 * 60 * 1000;
          const { data: orderCheck } = await supabase
            .from("orders").select("status").eq("id", payloadOrderId).single();
          if (orderCheck) {
            const terminalStatuses = ['delivered', 'completed', 'cancelled', 'no_show', 'rejected', 'returned', 'failed'];
            const isTerminal = terminalStatuses.includes(orderCheck.status);
            const isStateMismatch = payloadStatus && payloadStatus !== orderCheck.status;
            const isNewOrderNotif = ['placed', 'enquired', 'requested'].includes(payloadStatus);
            if (((isStale && isTerminal) || isStateMismatch) && !isNewOrderNotif) {
              await supabase.from("user_notifications").insert({
                user_id: item.user_id, title: displayCopy.title, body: displayCopy.body,
                type: item.type,
                reference_path: item.reference_path, action_url: item.reference_path,
                queue_item_id: item.id,
                payload: item.payload, data: item.payload,
                is_read: true,
              });
              await supabase.from("notification_queue")
                .update({
                  status: "processed", processed_at: new Date().toISOString(),
                  push_attempted: false, push_skip_reason: "stale_or_terminal",
                }).eq("id", item.id);
              processed++;
              console.log(`[Queue][${item.id}] Skipped push: stale/terminal/mismatch`);
              continue;
            }
          }
        }

        // Insert in-app notification (with dedup via queue_item_id) — write both column pairs
        const { error: insertError } = await supabase.from("user_notifications").insert({
          user_id: item.user_id, title: displayCopy.title, body: displayCopy.body,
          type: item.type,
          reference_path: item.reference_path, action_url: item.reference_path,
          queue_item_id: item.id,
          payload: item.payload || null, data: item.payload || null,
        });
        if (insertError && insertError.code !== '23505') {
          throw new Error(`DB insert failed: ${insertError.message}`);
        }

        // ── WhatsApp channel (best-effort; never blocks push/in-app) ──
        try {
          const profile = profileMap.get(item.user_id);
          const wa = await deliverWhatsAppForQueueItem({
            userId: item.user_id,
            phone: profile?.phone,
            userName: profile?.name,
            type: item.type,
            title: displayCopy.title,
            body: displayCopy.body,
            payload: item.payload || {},
            whatsappPref: userPrefs?.whatsapp !== false,
            whatsappOptedInAt: userPrefs?.whatsapp_opted_in_at ?? null,
            promotionsPref: userPrefs?.promotions === true,
            notificationId: item.id,
          });
          if (wa.attempted) {
            pnqLog("whatsapp_delivery", {
              notification_id: item.id,
              success: !!wa.result?.success,
              code: wa.result?.code || null,
              used_template: wa.result?.usedTemplate ?? null,
              error: wa.result?.error || null,
            });
          } else if (wa.skipReason) {
            pnqLog("whatsapp_skip", { notification_id: item.id, reason: wa.skipReason });
          }
        } catch (waErr) {
          console.warn(`[Queue][${item.id}] WhatsApp channel error:`, waErr);
        }

        // Silent push: skip device delivery
        if (silentPush) {
          console.log(`[Queue][${item.id}] Silent push — skipping device delivery`);
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: false, push_skip_reason: "silent",
            }).eq("id", item.id);
          processed++;
          continue;
        }

        // If push provider is not available, mark as processed (in-app already delivered above)
        if (!pushAvailable || !creds) {
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: false, push_skip_reason: "no_credentials",
              last_error: "Push skipped — no push provider configured",
            }).eq("id", item.id);
          pnqLog("push_skip", { notification_id: item.id, reason: "no_credentials" });
          processed++;
          continue;
        }

        // ── PRIORITY DETECTION ──
        const rawPayload = item.payload || {};
        const targetRole = rawPayload.target_role || '';
        const notifStatus = rawPayload.status || '';

        const SELLER_HIGH_PRIORITY_STATUSES = ['placed', 'enquired', 'requested', 'quoted'];
        const BUYER_HIGH_PRIORITY_STATUSES = ['payment_failed', 'refund_failed', 'otp'];
        const SELLER_LIFECYCLE_TYPES = [
          'seller_approved',
          'STORE_APPROVED',
          'seller_rejected',
          'seller_suspended',
          'seller_store_submitted',
          'seller_store_under_review',
          'seller_credit_purchased',
          'seller_credit_failed',
        ];

        const isHighPriority =
          (targetRole === 'seller' && SELLER_HIGH_PRIORITY_STATUSES.includes(notifStatus)) ||
          (targetRole === 'buyer' && BUYER_HIGH_PRIORITY_STATUSES.includes(notifStatus)) ||
          item.type === 'seller_order_status_reminder' ||
          rawPayload.reminder_type === 'status_nudge' ||
          SELLER_LIFECYCLE_TYPES.includes(item.type);

        // Quiet hours: suppress non-urgent push (inbox + WA already handled)
        if (
          userPrefs &&
          !isHighPriority &&
          isWithinQuietHours({
            enabled: userPrefs.quiet_hours_enabled,
            startHour: userPrefs.quiet_hours_start,
            endHour: userPrefs.quiet_hours_end,
            timezone: userPrefs.timezone,
          })
        ) {
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: false, push_skip_reason: "quiet_hours",
            }).eq("id", item.id);
          pnqLog("push_skip", { notification_id: item.id, reason: "quiet_hours", user_id: item.user_id });
          skippedQuiet++;
          processed++;
          continue;
        }

        // Per-user push rate limit (high-priority still counts but is allowed through if over — soft)
        const rateKey = `notif_push:${item.user_id}`;
        const rate = await checkRateLimit(rateKey, maxPerHour, 3600);
        if (!rate.allowed && !isHighPriority) {
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: false, push_skip_reason: "rate_limited",
            }).eq("id", item.id);
          pnqLog("push_skip", { notification_id: item.id, reason: "rate_limited", user_id: item.user_id });
          skippedRate++;
          processed++;
          continue;
        }

        pnqLog("push_priority", {
          notification_id: item.id,
          user_id: item.user_id,
          target_role: targetRole || 'unknown',
          status: notifStatus || 'unknown',
          isHighPriority,
          sound: isHighPriority ? 'gate_bell' : 'default',
        });

        // ── INLINE PUSH DELIVERY (no function-to-function call) ──
        const TERMINAL_PUSH_STATUSES = [
          'cancelled', 'completed', 'delivered', 'rejected', 'no_show',
          'returned', 'failed', 'expired',
        ];
        const resolvedOrderId = payloadOrderId
          || rawPayload.orderId
          || rawPayload.order_id
          || rawPayload.entity_id
          || null;
        const pushData: Record<string, string> = {};
        if (rawPayload.action) pushData.action = String(rawPayload.action);
        if (rawPayload.reference_path) pushData.reference_path = String(rawPayload.reference_path);
        else if (item.reference_path) pushData.reference_path = item.reference_path;
        if (rawPayload.action_url) pushData.action_url = String(rawPayload.action_url);
        else if (pushData.reference_path) pushData.action_url = pushData.reference_path;
        else if (item.reference_path) pushData.action_url = item.reference_path;
        if (!pushData.route && (pushData.action_url || item.reference_path)) {
          pushData.route = pushData.action_url || item.reference_path;
        }
        // Pass priority info to client for foreground sound decision
        pushData.high_priority = isHighPriority ? 'true' : 'false';
        if (targetRole) pushData.target_role = targetRole;
        if (notifStatus) pushData.status = notifStatus;
        // Client sync metadata — required for order-terminal-push / overlay dismiss
        if (resolvedOrderId) {
          const oid = String(resolvedOrderId);
          pushData.order_id = oid;
          pushData.orderId = oid;
          pushData.entity_id = oid;
          pushData.entity_type = 'order';
        }
        if (notifStatus) {
          pushData.is_terminal = TERMINAL_PUSH_STATUSES.includes(String(notifStatus)) ? 'true' : 'false';
        }
        if (item.type) pushData.type = String(item.type);
        if (rawPayload.reminder_type) pushData.reminder_type = String(rawPayload.reminder_type);
        if (item.id) pushData.queue_item_id = String(item.id);
        if (rawPayload.notif_id) pushData.notif_id = String(rawPayload.notif_id);
        // Include queue creation time so the client can detect stale pushes buffered by FCM/APNs.
        if (item.created_at) pushData.created_at = String(item.created_at);

        const threadId = resolvedOrderId
          ? String(resolvedOrderId)
          : (rawPayload.orderId ? String(rawPayload.orderId) : undefined);
        const imageUrl = rawPayload.image_url ? String(rawPayload.image_url) : undefined;

        const { successCount, failCount } = await deliverPushToUser(
          supabase, creds, item.user_id,
          displayCopy.title, displayCopy.body, pushData,
          threadId, imageUrl, item.id, isHighPriority,
        );

        if (successCount > 0 || failCount === 0) {
          // At least one token succeeded OR no tokens exist — mark processed
          const skipReason = (successCount === 0 && failCount === 0) ? "no_tokens" : null;
          if (skipReason) pnqLog("push_skip", { notification_id: item.id, reason: skipReason });
          await supabase.from("notification_queue")
            .update({
              status: "processed", processed_at: new Date().toISOString(),
              push_attempted: true,
              push_success_count: successCount,
              push_fail_count: failCount,
              push_skip_reason: skipReason,
            }).eq("id", item.id);
          // Audit: mark delivered when at least one token succeeded
          if (successCount > 0) {
            try {
              const { error: deliveredError } = await supabase.rpc(
                "fn_mark_notification_delivered",
                { _queue_id: item.id },
              );
              if (deliveredError) {
                console.warn(`[Queue][${item.id}] delivery audit failed: ${deliveredError.message}`);
              }
            } catch (deliveredError) {
              // Delivery audit is best-effort and must never dead-letter a push
              // that was already accepted by FCM/APNs.
              console.warn(`[Queue][${item.id}] delivery audit exception: ${String(deliveredError)}`);
            }
          }
          processed++;
        } else {
          // All tokens failed — re-queue with 15s delay
          const retryCount = (item.retry_count || 0) + 1;
          if (retryCount >= MAX_TOTAL_ATTEMPTS) {
            const lastError = "All push delivery attempts exhausted";
            await supabase.from("notification_queue").update({
              status: "failed", processed_at: new Date().toISOString(),
              retry_count: retryCount, last_error: lastError,
              push_attempted: true,
              push_success_count: successCount,
              push_fail_count: failCount,
            }).eq("id", item.id);
            await moveToDeadLetter(supabase, {
              id: item.id,
              user_id: item.user_id,
              type: item.type,
              title: item.title,
              body: item.body,
              reference_path: item.reference_path,
              payload: item.payload,
              retry_count: retryCount,
              last_error: lastError,
            });
            deadLettered++;
            console.error(`[Queue][${item.id}] Dead-lettered after ${retryCount} attempts`);
          } else {
            const nextRetryAt = new Date(Date.now() + 15_000).toISOString();
            await supabase.from("notification_queue").update({
              status: "pending", retry_count: retryCount,
              last_error: "Push delivery failed, re-queued",
              next_retry_at: nextRetryAt,
              push_attempted: true,
              push_success_count: successCount,
              push_fail_count: failCount,
            }).eq("id", item.id);
            retriedCount++;
            console.warn(`[Queue][${item.id}] Re-queued (attempt ${retryCount}) at ${nextRetryAt}`);
          }
        }
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        await supabase.from("notification_queue").update({
          status: "failed", processed_at: new Date().toISOString(), last_error: errorMsg,
        }).eq("id", item.id);
        await moveToDeadLetter(supabase, {
          id: item.id,
          user_id: item.user_id,
          type: item.type,
          title: item.title,
          body: item.body,
          reference_path: item.reference_path,
          payload: item.payload,
          retry_count: item.retry_count,
          last_error: errorMsg,
        });
        deadLettered++;
        console.error(`[Queue][${item.id}] Fatal error: ${errorMsg}`);
      }
    }

    pnqLog("batch_summary", {
      total: pending.length,
      processed,
      dead_lettered: deadLettered,
      retried: retriedCount,
      skipped_prefs: skippedPrefs,
      skipped_quiet: skippedQuiet,
      skipped_rate: skippedRate,
      duration_ms: Date.now() - batchStarted,
      oldest_age_ms: Date.now() - oldestCreated,
    });

    // Self-reschedule: replaces the cron sweep. If more items are due now,
    // re-invoke immediately; if items are scheduled for the future, queue
    // a delayed self-invoke so retries fire without pg_cron.
    await scheduleNextRun(supabase, supabaseUrl);

    return new Response(
      JSON.stringify({
        processed,
        dead_lettered: deadLettered,
        retried: retriedCount,
        skipped_prefs: skippedPrefs,
        skipped_quiet: skippedQuiet,
        skipped_rate: skippedRate,
        total: pending.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-notification-queue:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
