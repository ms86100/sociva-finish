import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getCredential } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TOTAL_ATTEMPTS = 9; // 3 retry cycles of 3 attempts each
const PUSH_TIMEOUT_MS = 5000;

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
  threadId?: string, imageUrl?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cryptoKey = await importP8Key(p8Key);
    const jwt = await createApnsJwt(cryptoKey, keyId, teamId);
    const apnsPayload: Record<string, unknown> = {
      aps: {
        alert: { title, body },
        sound: "gate_bell.mp3",
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
  threadId?: string, imageUrl?: string,
): Promise<{ success: boolean; error?: string }> {
  const androidNotif: Record<string, unknown> = { sound: "gate_bell", channel_id: "orders_alert" };
  if (threadId) androidNotif.tag = threadId;
  if (imageUrl) androidNotif.image = imageUrl;
  const fcmNotif: Record<string, unknown> = { title, body };
  if (imageUrl) fcmNotif.image = imageUrl;
  const apnsAps: Record<string, unknown> = { alert: { title, body }, sound: "gate_bell.mp3", badge: 1 };
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
  serviceAccount: FirebaseServiceAccount;
  fcmAccessToken: string;
  apnsConfigured: boolean;
  apnsP8Key?: string;
  apnsKeyId?: string;
  apnsTeamId?: string;
  apnsBundleId?: string;
}

async function loadCredentials(supabase: any): Promise<CachedCredentials> {
  const serviceAccountJson = await getCredential(supabase, "firebase_service_account", "FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  const serviceAccount: FirebaseServiceAccount = JSON.parse(serviceAccountJson);
  const fcmAccessToken = await generateFcmAccessToken(serviceAccount);

  const [apnsP8Key, apnsKeyId, apnsTeamId, apnsBundleId] = await Promise.all([
    getCredential(supabase, "apns_key_p8", "APNS_KEY_P8"),
    getCredential(supabase, "apns_key_id", "APNS_KEY_ID"),
    getCredential(supabase, "apns_team_id", "APNS_TEAM_ID"),
    getCredential(supabase, "apns_bundle_id", "APNS_BUNDLE_ID"),
  ]);
  const apnsConfigured = !!(apnsP8Key && apnsKeyId && apnsTeamId && apnsBundleId);

  return { serviceAccount, fcmAccessToken, apnsConfigured, apnsP8Key, apnsKeyId, apnsTeamId, apnsBundleId };
}

async function deliverPushToUser(
  supabase: any, creds: CachedCredentials, userId: string,
  title: string, body: string, pushData: Record<string, string>,
  threadId?: string, imageUrl?: string, notificationId?: string,
): Promise<{ successCount: number; failCount: number }> {
  const startMs = Date.now();

  // Fetch valid device tokens
  const { data: tokens, error: tokensErr } = await supabase
    .from("device_tokens")
    .select("id, token, platform, apns_token, updated_at, invalid_count")
    .eq("user_id", userId)
    .eq("invalid", false);

  if (tokensErr || !tokens || tokens.length === 0) {
    console.log(JSON.stringify({ event: "push_no_tokens", notification_id: notificationId, user_id: userId }));
    return { successCount: 0, failCount: 0 };
  }

  // Deduplicate: keep latest per platform
  const sorted = [...tokens].sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const seenPlatform = new Set<string>();
  const deduped = sorted.filter((t: any) => {
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
      // iOS with APNs token → direct APNs (primary), FCM fallback
      if (tokenRecord.platform === "ios" && tokenRecord.apns_token && creds.apnsConfigured) {
        result = await withTimeout(
          sendApnsDirect(tokenRecord.apns_token, title, body, pushData, creds.apnsP8Key!, creds.apnsKeyId!, creds.apnsTeamId!, creds.apnsBundleId!, threadId, imageUrl),
          PUSH_TIMEOUT_MS,
        );
        // FCM fallback if APNs fails (non-invalid) and we have a real FCM token
        if (!result.success && result.error !== "INVALID_TOKEN" && !isApnsOnlyToken) {
          console.log(`[Push] APNs failed for ${notificationId}, falling back to FCM`);
          result = await withTimeout(
            sendFcmDirect(creds.fcmAccessToken, creds.serviceAccount.project_id, tokenRecord.token, title, body, pushData, threadId, imageUrl),
            PUSH_TIMEOUT_MS,
          );
        }
      } else if (isApnsOnlyToken) {
        // APNs-only token but APNs not configured
        result = { success: false, error: "APNS_NOT_CONFIGURED" };
      } else {
        // Android or iOS without APNs → FCM
        result = await withTimeout(
          sendFcmDirect(creds.fcmAccessToken, creds.serviceAccount.project_id, tokenRecord.token, title, body, pushData, threadId, imageUrl),
          PUSH_TIMEOUT_MS,
        );
      }
    } catch (err) {
      result = { success: false, error: String(err) };
    }

    // Safe token handling: mark invalid, never delete on first failure
    if (result.error === "INVALID_TOKEN") {
      await supabase.from("device_tokens").update({
        invalid: true,
        invalid_count: (tokenRecord.invalid_count || 0) + 1,
      }).eq("id", tokenRecord.id);
      console.log(`[Push] Marked token ${tokenRecord.id} as invalid (count: ${(tokenRecord.invalid_count || 0) + 1})`);
    }

    console.log(JSON.stringify({
      event: "push_delivery",
      notification_id: notificationId,
      platform: tokenRecord.platform,
      success: result.success,
      duration_ms: Date.now() - tokenStartMs,
      error: result.error || null,
    }));

    if (result.success) successCount++;
    else failCount++;
  }

  return { successCount, failCount };
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

    // Allow service-role, anon key (cron), or valid user JWT
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const isAllowed = !authHeader || token === supabaseServiceKey || token === anonKey;
    if (authHeader && !isAllowed) {
      const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.93.3");
      const authClient = cc(supabaseUrl, anonKey!, { global: { headers: { Authorization: authHeader } } });
      const { error: authErr } = await authClient.auth.getUser();
      if (authErr) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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

    // Atomically claim pending notifications
    const { data: pending, error: fetchError } = await supabase
      .rpc("claim_notification_queue", { batch_size: 50 });

    if (fetchError) {
      console.error("Error fetching queue:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0, retried: 0, dead_lettered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[PNQ] Processing ${pending.length} queued notifications`);

    // ── CREDENTIAL CACHING: Load ONCE per batch ──
    let creds: CachedCredentials | null = null;
    try {
      creds = await loadCredentials(supabase);
      console.log(`[PNQ] Credentials loaded: FCM ✅, APNs ${creds.apnsConfigured ? "✅" : "❌"}`);
    } catch (credErr) {
      console.error(`[PNQ] Failed to load credentials: ${credErr}`);
      // Re-queue all as pending with 15s delay — credentials may be temporarily unavailable
      for (const item of pending) {
        await supabase.from("notification_queue").update({
          status: "pending",
          retry_count: (item.retry_count || 0) + 1,
          last_error: `Credential load failed: ${credErr}`,
        }).eq("id", item.id);
      }
      return new Response(JSON.stringify({ error: "Credential load failed, batch re-queued" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch-fetch notification preferences
    const userIds = [...new Set(pending.map((item: any) => item.user_id))];
    const { data: prefRows } = await supabase
      .from("notification_preferences")
      .select("user_id, orders, chat, promotions")
      .in("user_id", userIds);
    const prefMap = new Map<string, Record<string, boolean>>();
    for (const row of prefRows || []) {
      prefMap.set(row.user_id, { orders: row.orders, chat: row.chat, promotions: row.promotions });
    }

    let processed = 0;
    let deadLettered = 0;
    let skippedPrefs = 0;
    let retriedCount = 0;

    for (const item of pending) {
      try {
        // Enforce user notification preferences
        const userPrefs = prefMap.get(item.user_id);
        const notifType = item.type || item.payload?.type || "order";
        let prefAllowed = true;
        if (userPrefs) {
          const isOrderRelated = notifType === "order" || notifType === "order_status" || notifType === "order_update"
            || notifType.startsWith("delivery_") || notifType.startsWith("booking_");
          if (isOrderRelated && userPrefs.orders === false) prefAllowed = false;
          if (notifType === "chat" && userPrefs.chat === false) prefAllowed = false;
          if (notifType === "promotion" && userPrefs.promotions === false) prefAllowed = false;
        }
        if (!prefAllowed) {
          console.log(`[Queue][${item.id}] Skipped push — user opted out of '${notifType}'`);
          await supabase.from("user_notifications").insert({
            user_id: item.user_id, title: item.title, body: item.body,
            type: item.type, reference_path: item.reference_path,
            queue_item_id: item.id, payload: item.payload || null,
          });
          await supabase.from("notification_queue")
            .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", item.id);
          skippedPrefs++;
          processed++;
          continue;
        }

        const silentPush = item.payload?.silent_push === true;

        // Dedup check — skip if same (user_id, type, reference_path) exists within last 60s
        if (item.reference_path) {
          const sixtySecsAgo = new Date(Date.now() - 60_000).toISOString();
          const { data: existing } = await supabase
            .from("user_notifications")
            .select("id")
            .eq("user_id", item.user_id).eq("type", item.type)
            .eq("reference_path", item.reference_path)
            .gte("created_at", sixtySecsAgo).limit(1);
          if (existing && existing.length > 0) {
            console.log(`[Queue][${item.id}] Duplicate skipped`);
            await supabase.from("notification_queue")
              .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", item.id);
            processed++;
            continue;
          }
        }

        // Guards: staleness + terminal-state + state-mismatch
        const isOrderNotif = ['order_status', 'order', 'order_update'].includes(item.type);
        if (isOrderNotif && item.payload?.orderId) {
          const ageMs = Date.now() - new Date(item.created_at).getTime();
          const isStale = ageMs > 5 * 60 * 1000;
          const { data: orderCheck } = await supabase
            .from("orders").select("status").eq("id", item.payload.orderId).single();
          if (orderCheck) {
            const terminalStatuses = ['delivered', 'completed', 'cancelled', 'no_show'];
            const isTerminal = terminalStatuses.includes(orderCheck.status);
            const isStateMismatch = item.payload?.status && item.payload.status !== orderCheck.status;
            const isNewOrderNotif = ['placed', 'enquired', 'requested'].includes(item.payload?.status);
            if (((isStale && isTerminal) || isStateMismatch) && !isNewOrderNotif) {
              await supabase.from("user_notifications").insert({
                user_id: item.user_id, title: item.title, body: item.body,
                type: item.type, reference_path: item.reference_path,
                queue_item_id: item.id, payload: item.payload, is_read: true,
              });
              await supabase.from("notification_queue")
                .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", item.id);
              processed++;
              console.log(`[Queue][${item.id}] Skipped push: stale/terminal/mismatch`);
              continue;
            }
          }
        }

        // Insert in-app notification (with dedup via queue_item_id)
        const { error: insertError } = await supabase.from("user_notifications").insert({
          user_id: item.user_id, title: item.title, body: item.body,
          type: item.type, reference_path: item.reference_path,
          queue_item_id: item.id, payload: item.payload || null,
        });
        if (insertError && insertError.code !== '23505') {
          throw new Error(`DB insert failed: ${insertError.message}`);
        }

        // Silent push: skip device delivery
        if (silentPush) {
          console.log(`[Queue][${item.id}] Silent push — skipping device delivery`);
          await supabase.from("notification_queue")
            .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", item.id);
          processed++;
          continue;
        }

        // ── INLINE PUSH DELIVERY (no function-to-function call) ──
        const pushData: Record<string, string> = {};
        const rawPayload = item.payload || {};
        if (rawPayload.action) pushData.action = String(rawPayload.action);
        if (rawPayload.reference_path) pushData.reference_path = String(rawPayload.reference_path);
        else if (item.reference_path) pushData.reference_path = item.reference_path;
        if (!pushData.route && item.reference_path) pushData.route = item.reference_path;

        const threadId = rawPayload.orderId ? String(rawPayload.orderId) : undefined;
        const imageUrl = rawPayload.image_url ? String(rawPayload.image_url) : undefined;

        const { successCount, failCount } = await deliverPushToUser(
          supabase, creds, item.user_id,
          item.title, item.body, pushData,
          threadId, imageUrl, item.id,
        );

        if (successCount > 0 || failCount === 0) {
          // At least one token succeeded OR no tokens exist — mark processed
          await supabase.from("notification_queue")
            .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", item.id);
          processed++;
        } else {
          // All tokens failed — re-queue with 15s delay
          const retryCount = (item.retry_count || 0) + 1;
          if (retryCount >= MAX_TOTAL_ATTEMPTS) {
            await supabase.from("notification_queue").update({
              status: "failed", processed_at: new Date().toISOString(),
              retry_count: retryCount, last_error: "All push delivery attempts exhausted",
            }).eq("id", item.id);
            deadLettered++;
            console.error(`[Queue][${item.id}] Dead-lettered after ${retryCount} attempts`);
          } else {
            const nextRetryAt = new Date(Date.now() + 15_000).toISOString();
            await supabase.from("notification_queue").update({
              status: "pending", retry_count: retryCount,
              last_error: "Push delivery failed, re-queued",
              created_at: nextRetryAt,
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
        deadLettered++;
        console.error(`[Queue][${item.id}] Fatal error: ${errorMsg}`);
      }
    }

    console.log(JSON.stringify({
      event: "batch_summary", total: pending.length,
      processed, dead_lettered: deadLettered, retried: retriedCount, skipped_prefs: skippedPrefs,
    }));

    return new Response(
      JSON.stringify({ processed, dead_lettered: deadLettered, retried: retriedCount, skipped_prefs: skippedPrefs, total: pending.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in process-notification-queue:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
