/**
 * LiveKit Cloud JWT mint for Sociva VoIP.
 * Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 * Returns null tokens when secrets are missing (feature stays gated).
 */

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export function loadLiveKitEnv() {
  return {
    url: (Deno.env.get("LIVEKIT_URL") || "").trim(),
    apiKey: (Deno.env.get("LIVEKIT_API_KEY") || "").trim(),
    apiSecret: (Deno.env.get("LIVEKIT_API_SECRET") || "").trim(),
  };
}

export function livekitConfigured(): boolean {
  const e = loadLiveKitEnv();
  return !!(e.url && e.apiKey && e.apiSecret);
}

export async function mintLiveKitParticipantToken(opts: {
  room: string;
  identity: string;
  name?: string;
  ttlSeconds?: number;
}): Promise<{ token: string; url: string } | null> {
  const env = loadLiveKitEnv();
  if (!env.url || !env.apiKey || !env.apiSecret) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, opts.ttlSeconds ?? 3600);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: env.apiKey,
    sub: opts.identity,
    nbf: now - 10,
    exp,
    name: opts.name || opts.identity,
    video: {
      roomJoin: true,
      room: opts.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const body = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await hmacSha256(env.apiSecret, body);
  return { token: `${body}.${b64url(sig)}`, url: env.url };
}
