/**
 * Upstash Redis REST client for Supabase Edge Functions.
 *
 * Why REST (not TCP): Deno Edge isolates cannot rely on persistent Redis TCP
 * sockets. Upstash HTTP works from every Edge Function isolate.
 *
 * Credential resolution order:
 * 1) Deno.env UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * 2) Deno.env KV_REST_API_URL / KV_REST_API_TOKEN (Vercel Marketplace)
 * 3) get_edge_credential('upstash_redis_rest_url' | 'upstash_redis_rest_token')
 *
 * When unset, callers must fall back to Postgres (see rate-limiter.ts).
 */

import { getCredential } from "./credentials.ts";

export type RedisConfig = {
  url: string;
  token: string;
};

let _cachedConfig: RedisConfig | null | undefined;
let _resolveInFlight: Promise<RedisConfig | null> | null = null;

function readEnvConfig(): RedisConfig | null {
  const url = (
    Deno.env.get("UPSTASH_REDIS_REST_URL") ||
    Deno.env.get("KV_REST_API_URL") ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const token = (
    Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ||
    Deno.env.get("KV_REST_API_TOKEN") ||
    ""
  ).trim();

  if (!url || !token) return null;
  return { url, token };
}

/** Sync peek of env-only config (no vault). Prefer resolveRedisConfig in request paths. */
export function getRedisConfig(): RedisConfig | null {
  if (_cachedConfig !== undefined) return _cachedConfig;
  const fromEnv = readEnvConfig();
  if (fromEnv) {
    _cachedConfig = fromEnv;
    return fromEnv;
  }
  return null;
}

/** Full resolve: env first, then vault/admin_settings via get_edge_credential. */
export async function resolveRedisConfig(supabase?: any): Promise<RedisConfig | null> {
  if (_cachedConfig) return _cachedConfig;

  const fromEnv = readEnvConfig();
  if (fromEnv) {
    _cachedConfig = fromEnv;
    return fromEnv;
  }

  if (!supabase) {
    return null;
  }

  if (_resolveInFlight) return _resolveInFlight;

  _resolveInFlight = (async () => {
    try {
      const [url, token] = await Promise.all([
        getCredential(supabase, "upstash_redis_rest_url", "UPSTASH_REDIS_REST_URL"),
        getCredential(supabase, "upstash_redis_rest_token", "UPSTASH_REDIS_REST_TOKEN"),
      ]);
      const cleanedUrl = (url || "").trim().replace(/\/$/, "");
      const cleanedToken = (token || "").trim();
      if (!cleanedUrl || !cleanedToken) {
        _cachedConfig = null;
        return null;
      }
      _cachedConfig = { url: cleanedUrl, token: cleanedToken };
      return _cachedConfig;
    } finally {
      _resolveInFlight = null;
    }
  })();

  return _resolveInFlight;
}

/** Test helper - clears module cache between tests. */
export function resetRedisConfigCache(): void {
  _cachedConfig = undefined;
  _resolveInFlight = null;
}

type UpstashResult = { result?: unknown; error?: string };

async function upstashFetch(
  config: RedisConfig,
  pathSegments: string[],
): Promise<UpstashResult> {
  const path = pathSegments.map((s) => encodeURIComponent(s)).join("/");
  const res = await fetch(`${config.url}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  const body = (await res.json().catch(() => ({}))) as UpstashResult;
  if (!res.ok) {
    throw new Error(body.error || `Upstash HTTP ${res.status}`);
  }
  if (body.error) {
    throw new Error(body.error);
  }
  return body;
}

async function upstashPipeline(
  config: RedisConfig,
  commands: (string | number)[][],
): Promise<UpstashResult[]> {
  const res = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Upstash pipeline HTTP ${res.status}`;
    throw new Error(err);
  }
  if (!Array.isArray(body)) {
    throw new Error("Upstash pipeline returned non-array");
  }
  return body as UpstashResult[];
}

/** Ping Redis. Returns false when not configured or unreachable. */
export async function redisPing(supabase?: any): Promise<boolean> {
  const config = (await resolveRedisConfig(supabase)) || getRedisConfig();
  if (!config) return false;
  try {
    const body = await upstashFetch(config, ["PING"]);
    return String(body.result).toUpperCase() === "PONG";
  } catch (e) {
    console.error("[redis] PING failed:", e);
    return false;
  }
}

/**
 * Fixed-window rate limit via INCR + EXPIRE NX.
 * Returns null when Redis is not configured (caller should use Postgres).
 */
export async function redisFixedWindowIncr(
  key: string,
  windowSeconds: number,
  supabase?: any,
): Promise<{ count: number; ttlSeconds: number } | null> {
  const config = (await resolveRedisConfig(supabase)) || getRedisConfig();
  if (!config) return null;

  const redisKey = key.startsWith("rl:") ? key : `rl:${key}`;
  const ttl = Math.max(1, Math.floor(windowSeconds));

  const results = await upstashPipeline(config, [
    ["INCR", redisKey],
    ["EXPIRE", redisKey, ttl, "NX"],
    ["TTL", redisKey],
  ]);

  const count = Number(results[0]?.result ?? 0);
  let ttlSeconds = Number(results[2]?.result ?? ttl);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    await upstashFetch(config, ["EXPIRE", redisKey, String(ttl)]);
    ttlSeconds = ttl;
  }

  return { count, ttlSeconds: Math.max(1, ttlSeconds) };
}
