/**
 * PushKit VoIP APNs sender for Sociva.
 * Topic: {bundleId}.voip  |  push-type: voip
 * Resolves credentials from vault/admin_settings first, then Edge secrets.
 * Keys: apns_auth_key / apns_key_p8, apns_key_id, apns_team_id, apns_bundle_id
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

function sanitizePlain(raw: string): string {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function readCredential(
  admin: any | null,
  dbKey: string,
  envKey: string,
): Promise<string> {
  // Prefer vault/admin_settings so a corrected .p8 wins over stale Edge env secrets.
  if (admin) {
    try {
      const { data, error } = await admin.rpc("get_edge_credential", {
        p_key: dbKey,
      });
      if (!error && typeof data === "string" && sanitizePlain(data).length > 0) {
        return data;
      }
    } catch {
      // fall through to env
    }
  }
  return Deno.env.get(envKey) || "";
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
  // Apple accepts iss + iat only. An exp claim can return InvalidProviderToken.
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

export type ApnsVoipEnv = {
  p8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
};

export async function loadApnsVoipEnv(admin: any | null = null): Promise<ApnsVoipEnv> {
  const p8Raw =
    (await readCredential(admin, "apns_auth_key", "APNS_AUTH_KEY")) ||
    (await readCredential(admin, "apns_key_p8", "APNS_KEY_P8"));
  return {
    p8: sanitizePem(p8Raw),
    keyId: sanitizePlain(await readCredential(admin, "apns_key_id", "APNS_KEY_ID")),
    teamId: sanitizePlain(await readCredential(admin, "apns_team_id", "APNS_TEAM_ID")),
    bundleId: sanitizePlain(
      await readCredential(admin, "apns_bundle_id", "APNS_BUNDLE_ID"),
    ),
  };
}

export function apnsVoipConfiguredFrom(env: ApnsVoipEnv): boolean {
  return !!(env.p8 && env.keyId && env.teamId && env.bundleId);
}

/** Sync check against Edge env only (capabilities probe). */
export function apnsVoipConfigured(): boolean {
  const p8 =
    sanitizePem(Deno.env.get("APNS_AUTH_KEY") || "") ||
    sanitizePem(Deno.env.get("APNS_KEY_P8") || "");
  const keyId = sanitizePlain(Deno.env.get("APNS_KEY_ID") || "");
  const teamId = sanitizePlain(Deno.env.get("APNS_TEAM_ID") || "");
  const bundleId = sanitizePlain(Deno.env.get("APNS_BUNDLE_ID") || "");
  return !!(p8 && keyId && teamId && bundleId);
}

export async function sendApnsVoipPush(
  deviceToken: string,
  payload: VoipPushPayload,
  admin: any | null = null,
): Promise<{ success: boolean; error?: string; topic?: string; key_id?: string }> {
  const env = await loadApnsVoipEnv(admin);
  if (!apnsVoipConfiguredFrom(env)) {
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
    if (resp.status === 200) {
      return { success: true, topic, key_id: env.keyId };
    }
    if (resp.status === 410) {
      return { success: false, error: "INVALID_TOKEN", topic, key_id: env.keyId };
    }
    const text = await resp.text().catch(() => "");
    return {
      success: false,
      error: `APNs ${resp.status}: ${text}`,
      topic,
      key_id: env.keyId,
    };
  } catch (err) {
    return { success: false, error: String(err), topic, key_id: env.keyId };
  }
}
