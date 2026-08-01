import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, getCredential } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Direct APNs test — bypasses Firebase entirely.
 * Sends a push directly to api.push.apple.com using the .p8 key.
 */

// Base64url encode
function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

/** Import the .p8 key (PKCS#8 PEM) as a CryptoKey for ES256 signing */
async function importP8Key(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
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

/** Create a signed JWT for APNs (ES256, 1-hour expiry) */
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

  // WebCrypto returns IEEE P1363 format (64 bytes for P-256) — APNs expects this
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { apns_token, title, body, use_sandbox } = await req.json();

    if (!apns_token) {
      return new Response(
        JSON.stringify({ error: "apns_token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createAdminClient();
    const [p8Key, keyId, teamId, bundleId] = await Promise.all([
      getCredential(adminClient, "apns_key_p8", "APNS_KEY_P8"),
      getCredential(adminClient, "apns_key_id", "APNS_KEY_ID"),
      getCredential(adminClient, "apns_team_id", "APNS_TEAM_ID"),
      getCredential(adminClient, "apns_bundle_id", "APNS_BUNDLE_ID"),
    ]);

    if (!p8Key || !keyId || !teamId || !bundleId) {
      return new Response(
        JSON.stringify({ error: "Missing APNs secrets (APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Import key and create JWT
    const cryptoKey = await importP8Key(p8Key);
    const jwt = await createApnsJwt(cryptoKey, keyId, teamId);

    // Choose endpoint
    const host = use_sandbox
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";

    const apnsPayload = {
      aps: {
        alert: {
          title: title || "Direct APNs Test",
          body: body || "If you see this, APNs is working! 🎉",
        },
        sound: "default",
        badge: 1,
      },
    };

    const url = `https://${host}/3/device/${apns_token}`;

    console.log(`[APNs] Sending to ${host}, token prefix: ${apns_token.substring(0, 16)}…`);

    const apnsResponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apnsPayload),
    });

    const statusCode = apnsResponse.status;
    let responseBody = "";
    try {
      responseBody = await apnsResponse.text();
    } catch {
      responseBody = "(empty)";
    }

    const apnsId = apnsResponse.headers.get("apns-id");
    const apnsUniqueId = apnsResponse.headers.get("apns-unique-id");

    console.log(`[APNs] Response: ${statusCode} — ${responseBody}`);

    // Interpretation
    let interpretation = "";
    switch (statusCode) {
      case 200:
        interpretation = "✅ SUCCESS — APNs accepted the notification. Your .p8 key and APNs environment are correct. If you still don't receive it, the issue is on the device side (e.g., Do Not Disturb, notification settings).";
        break;
      case 400:
        interpretation = "❌ BAD REQUEST — Likely BadDeviceToken. This means your app binary is signed for the WRONG APNs environment. If using TestFlight/App Store, try without use_sandbox. If local Xcode build, try with use_sandbox=true.";
        break;
      case 403:
        interpretation = "❌ FORBIDDEN — InvalidProviderToken. Your .p8 key, Key ID, or Team ID is incorrect or the key has been revoked.";
        break;
      case 410:
        interpretation = "❌ GONE — The device token is no longer active. The app was uninstalled or the token expired. Delete app, reinstall, and get a fresh token.";
        break;
      default:
        interpretation = `⚠️ Unexpected status ${statusCode}. Check APNs documentation.`;
    }

    return new Response(
      JSON.stringify({
        status: statusCode,
        response: responseBody || null,
        apns_id: apnsId,
        apns_unique_id: apnsUniqueId,
        host,
        token_prefix: apns_token.substring(0, 16),
        interpretation,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[APNs] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err), stack: (err as Error).stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
