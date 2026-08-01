import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCredential } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

interface CampaignRequest {
  title: string;
  body: string;
  data?: Record<string, string>;
  target?: {
    platform?: "all" | "ios" | "android";
    user_ids?: string[];
    society_id?: string | null;
  };
}

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

async function sendApnsDirect(
  apnsToken: string,
  title: string,
  body: string,
  jwt: string,
  bundleId: string,
  data?: Record<string, string>
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const apnsPayload: Record<string, unknown> = {
    aps: {
      alert: { title, body },
      sound: "default",
      badge: 1,
    },
    ...(data || {}),
  };

  try {
    const resp = await fetch(
      `https://api.push.apple.com/3/device/${apnsToken}`,
      {
        method: "POST",
        headers: {
          Authorization: `bearer ${jwt}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apnsPayload),
      }
    );

    let responseBody = "";
    try { responseBody = await resp.text(); } catch { responseBody = ""; }

    if (resp.status === 200) return { success: true };
    if (resp.status === 410) return { success: false, error: "INVALID_TOKEN", statusCode: 410 };
    return { success: false, error: `APNs ${resp.status}: ${responseBody}`, statusCode: resp.status };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── FCM Delivery (Android + fallback) ───

async function generateAccessToken(sa: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyPem = sa.private_key.replace(/\\n/g, "\n");
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .trim();

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(unsignedToken)
  );
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsignedToken}.${signatureB64}`;
  const tokenResponse = await fetch(sa.token_uri, {
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

async function sendFCM(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    message: {
      token: deviceToken,
      notification: { title, body },
      data: data || {},
      android: { priority: "high", notification: { sound: "default" } },
      apns: {
        headers: { "apns-push-type": "alert", "apns-priority": "10" },
        payload: { aps: { alert: { title, body }, sound: "default", badge: 1 } },
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
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Batching helpers ───

const BATCH_SIZE = 500;
const CONCURRENCY = 20;

async function processConcurrently<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ─── Main Handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // ── Auth: verify caller is admin ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user-scoped client to verify identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(
        JSON.stringify({ error: "Forbidden — admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse request ──
    const { title, body, data, target }: CampaignRequest = await req.json();
    if (!title || !body) {
      return new Response(
        JSON.stringify({ error: "title and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const platform = target?.platform || "all";
    const userIds = target?.user_ids || [];
    const societyId = target?.society_id || null;

    // ── Create campaign record ──
    const { data: campaign, error: insertErr } = await adminClient
      .from("campaigns")
      .insert({
        title,
        body,
        data: data || {},
        target_platform: platform,
        target_user_ids: userIds,
        target_society_id: societyId,
        sent_by: user.id,
        status: "sending",
      })
      .select("id")
      .single();

    if (insertErr || !campaign) {
      throw new Error(`Failed to create campaign: ${insertErr?.message}`);
    }

    const campaignId = campaign.id;
    console.log(`[Campaign] Created ${campaignId}, querying tokens...`);

    // ── Query device tokens (paginated) ──
    let allTokens: any[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      let query = adminClient
        .from("device_tokens")
        .select("id, token, platform, apns_token, user_id, updated_at")
        .range(from, from + pageSize - 1);

      if (platform === "ios") query = query.eq("platform", "ios");
      else if (platform === "android") query = query.eq("platform", "android");

      if (userIds.length > 0) query = query.in("user_id", userIds);

      const { data: tokens, error: tokErr } = await query;
      if (tokErr) throw new Error(`Failed to fetch tokens: ${tokErr.message}`);
      if (!tokens || tokens.length === 0) break;

      allTokens.push(...tokens);
      if (tokens.length < pageSize) break;
      from += pageSize;
    }

    // If society filter, get user IDs from profiles and filter
    if (societyId && userIds.length === 0) {
      const { data: societyProfiles } = await adminClient
        .from("profiles")
        .select("id")
        .eq("society_id", societyId);

      if (societyProfiles) {
        const societyUserIds = new Set(societyProfiles.map((p: any) => p.id));
        allTokens = allTokens.filter((t: any) => societyUserIds.has(t.user_id));
      }
    }

    // Deduplicate iOS tokens: keep only the most recently updated iOS entry per user
    allTokens.sort((a: any, b: any) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const seenIosUsers = new Set<string>();
    allTokens = allTokens.filter((t: any) => {
      if (t.platform === "ios") {
        if (seenIosUsers.has(t.user_id)) return false;
        seenIosUsers.add(t.user_id);
      }
      return true;
    });

    console.log(`[Campaign] ${campaignId} targeting ${allTokens.length} devices (after dedup)`);

    // Update targeted count
    await adminClient
      .from("campaigns")
      .update({ targeted_count: allTokens.length })
      .eq("id", campaignId);

    if (allTokens.length === 0) {
      await adminClient
        .from("campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaignId);

      return new Response(
        JSON.stringify({ campaign_id: campaignId, targeted: 0, sent: 0, failed: 0, cleaned: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Prepare delivery infrastructure (DB-first, env fallback) ──
    const [serviceAccountJson, p8Key, apnsKeyId, apnsTeamId, bundleId] = await Promise.all([
      getCredential(adminClient, "firebase_service_account", "FIREBASE_SERVICE_ACCOUNT"),
      getCredential(adminClient, "apns_key_p8", "APNS_KEY_P8"),
      getCredential(adminClient, "apns_key_id", "APNS_KEY_ID"),
      getCredential(adminClient, "apns_team_id", "APNS_TEAM_ID"),
      getCredential(adminClient, "apns_bundle_id", "APNS_BUNDLE_ID"),
    ]);

    if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT not configured (checked DB + env)");

    let serviceAccount: FirebaseServiceAccount;
    try { serviceAccount = JSON.parse(serviceAccountJson); }
    catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON"); }

    const fcmAccessToken = await generateAccessToken(serviceAccount);

    // APNs setup
    const apnsConfigured = !!(p8Key && apnsKeyId && apnsTeamId && bundleId);

    let apnsJwt = "";
    if (apnsConfigured) {
      const cryptoKey = await importP8Key(p8Key!);
      apnsJwt = await createApnsJwt(cryptoKey, apnsKeyId!, apnsTeamId!);
    }

    // ── Send in batches ──
    let sent = 0;
    let failed = 0;
    let cleaned = 0;
    const invalidTokenIds: string[] = [];

    for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
      const batch = allTokens.slice(i, i + BATCH_SIZE);
      console.log(`[Campaign] ${campaignId} batch ${Math.floor(i / BATCH_SIZE) + 1}, ${batch.length} devices`);

      const results = await processConcurrently(batch, CONCURRENCY, async (tokenRecord: any) => {
        let result: { success: boolean; error?: string };

        // iOS with APNs token → direct APNs
        if (tokenRecord.platform === "ios" && tokenRecord.apns_token && apnsConfigured) {
          result = await sendApnsDirect(
            tokenRecord.apns_token, title, body, apnsJwt, bundleId!, data
          );
          // Fallback to FCM if APNs fails (not invalid token)
          if (!result.success && result.error !== "INVALID_TOKEN") {
            result = await sendFCM(fcmAccessToken, serviceAccount.project_id, tokenRecord.token, title, body, data);
          }
        } else {
          // Android or iOS without APNs token → FCM
          result = await sendFCM(fcmAccessToken, serviceAccount.project_id, tokenRecord.token, title, body, data);
        }

        return { ...result, id: tokenRecord.id };
      });

      for (const r of results) {
        if (r.success) {
          sent++;
        } else {
          failed++;
          if (r.error === "INVALID_TOKEN") {
            invalidTokenIds.push(r.id);
          }
        }
      }
    }

    // ── Clean invalid tokens ──
    if (invalidTokenIds.length > 0) {
      const { error: delErr } = await adminClient
        .from("device_tokens")
        .delete()
        .in("id", invalidTokenIds);
      if (!delErr) cleaned = invalidTokenIds.length;
      console.log(`[Campaign] ${campaignId} cleaned ${cleaned} invalid tokens`);
    }

    // ── Update campaign record ──
    await adminClient
      .from("campaigns")
      .update({
        status: "completed",
        sent_count: sent,
        failed_count: failed,
        cleaned_count: cleaned,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`[Campaign] ${campaignId} completed: sent=${sent}, failed=${failed}, cleaned=${cleaned}`);

    return new Response(
      JSON.stringify({
        campaign_id: campaignId,
        targeted: allTokens.length,
        sent,
        failed,
        cleaned,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Campaign] Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
