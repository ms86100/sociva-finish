/**
 * PushKit VoIP APNs sender for Sociva.
 * Topic: {bundleId}.voip  |  push-type: voip
 * Reuses Edge secrets APNS_AUTH_KEY (or APNS_KEY_P8), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID.
 */

function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

function sanitizePem(raw: string): string {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");
}

async function importP8Key(pem: string): Promise<CryptoKey> {
  const cleaned = sanitizePem(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function createApnsJwt(
  key: CryptoKey,
  keyId: string,
  teamId: string,
): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64urlStr(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

export type VoipPushPayload = {
  call_id: string;
  caller_name: string;
  context_type?: string;
  context_id?: string;
  livekit_room?: string | null;
};

export function loadApnsVoipEnv() {
  const p8 =
    sanitizePem(Deno.env.get("APNS_AUTH_KEY") || "") ||
    sanitizePem(Deno.env.get("APNS_KEY_P8") || "");
  return {
    p8,
    keyId: (Deno.env.get("APNS_KEY_ID") || "").trim(),
    teamId: (Deno.env.get("APNS_TEAM_ID") || "").trim(),
    bundleId: (Deno.env.get("APNS_BUNDLE_ID") || "").trim(),
  };
}

export function apnsVoipConfigured(): boolean {
  const e = loadApnsVoipEnv();
  return !!(e.p8 && e.keyId && e.teamId && e.bundleId);
}

export async function sendApnsVoipPush(
  deviceToken: string,
  payload: VoipPushPayload,
): Promise<{ success: boolean; error?: string; topic?: string }> {
  const env = loadApnsVoipEnv();
  if (!apnsVoipConfigured()) {
    return { success: false, error: "APNS_VOIP_NOT_CONFIGURED" };
  }
  const topic = `${env.bundleId}.voip`;
  try {
    const key = await importP8Key(env.p8);
    const jwt = await createApnsJwt(key, env.keyId, env.teamId);
    const body = {
      aps: {
        "content-available": 1,
      },
      type: "voip_incoming",
      call_id: payload.call_id,
      caller_name: payload.caller_name || "Sociva",
      context_type: payload.context_type || "",
      context_id: payload.context_id || "",
      livekit_room: payload.livekit_room || "",
    };
    const url = `https://api.push.apple.com/3/device/${deviceToken}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "voip",
        "apns-priority": "10",
        "apns-expiration": "0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 200) return { success: true, topic };
    if (resp.status === 410) return { success: false, error: "INVALID_TOKEN", topic };
    const text = await resp.text().catch(() => "");
    return { success: false, error: `APNs ${resp.status}: ${text}`, topic };
  } catch (err) {
    return { success: false, error: String(err), topic };
  }
}
