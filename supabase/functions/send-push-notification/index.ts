import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCredential } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  threadId?: string;
  imageUrl?: string;
  isHighPriority?: boolean;
}

interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

// getCredential is now imported from _shared/credentials.ts

// ─── APNs Direct Delivery (iOS) ───

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

async function createApnsJwt(
  key: CryptoKey,
  keyId: string,
  teamId: string
): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64urlStr(
    JSON.stringify({ iss: teamId, iat: now, exp: now + 3600 })
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function sendApnsDirectNotification(
  apnsToken: string,
  title: string,
  body: string,
  data: Record<string, string> | undefined,
  p8Key: string,
  keyId: string,
  teamId: string,
  bundleId: string,
  threadId?: string,
  imageUrl?: string,
  highPriority = true,
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
    console.log(`[APNs] Sending to production APNs, token prefix: ${apnsToken.substring(0, 16)}…`);

    const apnsHeaders: Record<string, string> = {
      Authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "Content-Type": "application/json",
    };
    if (threadId) {
      apnsHeaders["apns-collapse-id"] = threadId.substring(0, 64);
    }

    const apnsResponse = await fetch(url, {
      method: "POST",
      headers: apnsHeaders,
      body: JSON.stringify(apnsPayload),
    });

    const statusCode = apnsResponse.status;
    let responseBody = "";
    try { responseBody = await apnsResponse.text(); } catch { responseBody = ""; }

    if (statusCode === 200) {
      const apnsId = apnsResponse.headers.get("apns-id");
      console.log(`[APNs] ✅ Delivered (apns-id: ${apnsId})`);
      return { success: true };
    }

    if (statusCode === 410) {
      console.warn(`[APNs] Token gone (410) — device unregistered`);
      return { success: false, error: "INVALID_TOKEN" };
    }

    console.error(`[APNs] Failed (${statusCode}): ${responseBody}`);
    return { success: false, error: `APNs ${statusCode}: ${responseBody}` };
  } catch (err) {
    console.error(`[APNs] Exception: ${err}`);
    return { success: false, error: String(err) };
  }
}

// ─── FCM Delivery (Android + fallback) ───

async function generateAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: serviceAccount.token_uri,
    iat: now,
    exp: exp,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyPem = serviceAccount.private_key.replace(/\\n/g, "\n");
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .trim();

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

async function sendFCMNotification(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  threadId?: string,
  imageUrl?: string,
  highPriority = true,
): Promise<{ success: boolean; error?: string }> {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const androidSound = highPriority ? "gate_bell" : "default";
  const androidChannel = highPriority ? "orders_alert" : "general";
  const androidNotification: Record<string, unknown> = {
    sound: androidSound,
    channel_id: androidChannel,
    icon: "ic_stat_sociva",
  };
  if (threadId) androidNotification.tag = threadId;
  if (imageUrl) androidNotification.image = imageUrl;

  const fcmNotification: Record<string, unknown> = { title, body };
  if (imageUrl) fcmNotification.image = imageUrl;

  const fcmApnsSound = highPriority ? "gate_bell.mp3" : "default";
  const apnsAps: Record<string, unknown> = {
    alert: { title, body },
    sound: fcmApnsSound,
    badge: 1,
  };
  if (imageUrl) apnsAps["mutable-content"] = 1;
  if (threadId) apnsAps["thread-id"] = threadId;

  const apnsHeaders: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-priority": "10",
  };
  if (threadId) apnsHeaders["apns-collapse-id"] = threadId.substring(0, 64);

  const message: Record<string, unknown> = {
    message: {
      token: deviceToken,
      notification: fcmNotification,
      data: data || {},
      android: {
        priority: "high",
        notification: androidNotification,
      },
      apns: {
        headers: apnsHeaders,
        payload: {
          aps: apnsAps,
          ...(imageUrl ? { image_url: imageUrl } : {}),
        },
      },
    },
  };

  try {
    const response = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errorData: any;
      try { errorData = JSON.parse(responseText); } catch { errorData = { raw: responseText }; }

      if (
        errorData.error?.details?.some(
          (d: { errorCode?: string }) =>
            d.errorCode === "UNREGISTERED" || d.errorCode === "INVALID_ARGUMENT"
        )
      ) {
        return { success: false, error: "INVALID_TOKEN" };
      }

      return { success: false, error: JSON.stringify(errorData) };
    }

    console.log(`[FCM] ✅ Delivered: ${responseText.substring(0, 200)}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Main Handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // C3: Only allow service-role callers (internal edge functions)
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — service role required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load Firebase credential from DB first, env fallback
    const serviceAccountJson = await getCredential(supabase, "firebase_service_account", "FIREBASE_SERVICE_ACCOUNT");
    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT not configured (checked DB + env)");
    }

    let serviceAccount: FirebaseServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (parseErr) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON`);
    }

    // Load APNs credentials from DB first, env fallback
    const [apnsP8Key, apnsKeyId, apnsTeamId, apnsBundleId] = await Promise.all([
      getCredential(supabase, "apns_key_p8", "APNS_KEY_P8"),
      getCredential(supabase, "apns_key_id", "APNS_KEY_ID"),
      getCredential(supabase, "apns_team_id", "APNS_TEAM_ID"),
      getCredential(supabase, "apns_bundle_id", "APNS_BUNDLE_ID"),
    ]);
    const apnsConfigured = !!(apnsP8Key && apnsKeyId && apnsTeamId && apnsBundleId);

    const { userId, title, body, data, threadId, imageUrl, isHighPriority: reqHighPriority }: PushPayload = await req.json();

    if (!userId || !title || !body) {
      return new Response(
        JSON.stringify({ error: "userId, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Priority detection: use explicit flag if provided, otherwise derive from data
    const SELLER_HP = ['placed', 'enquired', 'requested', 'quoted'];
    const BUYER_HP = ['payment_failed', 'refund_failed', 'otp'];
    const highPriority = reqHighPriority ??
      ((data?.target_role === 'seller' && SELLER_HP.includes(data?.status || '')) ||
       (data?.target_role === 'buyer' && BUYER_HP.includes(data?.status || '')));

    console.log(JSON.stringify({
      event: "push_priority", userId, isHighPriority: highPriority,
      target_role: data?.target_role || 'unknown', status: data?.status || 'unknown',
      sound: highPriority ? 'gate_bell' : 'default',
    }));

    // Fetch device tokens for user
    const { data: tokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("id, token, platform, apns_token, updated_at")
      .eq("user_id", userId);

    if (tokensError) {
      throw new Error(`Failed to fetch tokens: ${tokensError.message}`);
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ message: "No device tokens found for user", sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate tokens: keep only the most recently updated entry per platform per user
    const sorted = [...tokens].sort((a: any, b: any) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const seenPlatform = new Set<string>();
    const deduped = sorted.filter((t: any) => {
      if (seenPlatform.has(t.platform)) return false;
      seenPlatform.add(t.platform);
      return true;
    });

    if (deduped.length < tokens.length) {
      console.log(`[Push] Deduplicated ${tokens.length} tokens → ${deduped.length}`);
    }

    // Generate FCM access token
    const accessToken = await generateAccessToken(serviceAccount);

    // Send to deduplicated device tokens
    const results = await Promise.all(
      deduped.map(async (tokenRecord: any) => {
        let result: { success: boolean; error?: string };
        const isApnsOnlyToken = tokenRecord.token.startsWith("apns:");

        // iOS with stored APNs token → direct APNs delivery (primary path)
        if (tokenRecord.platform === "ios" && tokenRecord.apns_token && apnsConfigured) {
          console.log(`[Push] iOS device — using direct APNs for token prefix: ${tokenRecord.apns_token.substring(0, 16)}…`);
          result = await sendApnsDirectNotification(
            tokenRecord.apns_token,
            title,
            body,
            data,
            apnsP8Key!,
            apnsKeyId!,
            apnsTeamId!,
            apnsBundleId!,
            threadId,
            imageUrl,
            highPriority,
          );

          // If APNs fails and we have a real FCM token, fall back to FCM
           if (!result.success && result.error !== "INVALID_TOKEN" && !isApnsOnlyToken) {
            console.log(`[Push] APNs failed, falling back to FCM`);
            result = await sendFCMNotification(
              accessToken,
              serviceAccount.project_id,
              tokenRecord.token,
              title,
              body,
              data,
              threadId,
              imageUrl,
              highPriority,
            );
          }
        } else if (isApnsOnlyToken) {
          // APNs-only token but APNs not configured — skip
          console.log(`[Push] iOS APNs-only token but APNs not configured — skipping`);
          result = { success: false, error: "APNS_NOT_CONFIGURED" };
        } else {
          // Android or iOS without APNs token → FCM
          console.log(`[Push] ${tokenRecord.platform} device — using FCM`);
          result = await sendFCMNotification(
            accessToken,
            serviceAccount.project_id,
            tokenRecord.token,
            title,
            body,
            data,
            threadId,
            imageUrl,
            highPriority,
          );
        }

        // Remove invalid tokens
        if (result.error === "INVALID_TOKEN") {
          await supabase.from("device_tokens").delete().eq("id", tokenRecord.id);
          console.log(`Removed invalid token: ${tokenRecord.id}`);
        }

        return { ...result, platform: tokenRecord.platform };
      })
    );

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        message: `Sent ${successCount} notifications, ${failedCount} failed`,
        sent: successCount,
        failed: failedCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Push notification error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
