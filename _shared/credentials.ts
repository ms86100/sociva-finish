import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import {
  razorpayKeyCandidates,
  razorpayKeyMode,
  sanitizeCredential,
  selectRazorpayKeyPair,
  type RazorpayKeyPair,
} from "./razorpay-key-pair.ts";

/**
 * Credential resolution order (Phase 0 residual closeout):
 * 1) Deno.env / platform secrets
 * 2) Vault via get_edge_credential RPC (falls back to admin_settings server-side)
 *
 * Never prefer admin_settings SELECT from the edge. Authenticated admin UI must
 * use get_admin_credential_meta (meta-only — no raw secrets).
 */
export async function getCredential(
  supabase: any,
  dbKey: string,
  envKey: string
): Promise<string | undefined> {
  const fromEnv = sanitizeCredential(Deno.env.get(envKey));
  if (fromEnv.length > 0) return fromEnv;

  try {
    const { data, error } = await supabase.rpc("get_edge_credential", {
      p_key: dbKey,
    });
    if (!error && typeof data === "string") {
      const stored = sanitizeCredential(data);
      if (stored.length > 0) return stored;
    }
    if (error) {
      console.warn(`get_edge_credential failed for ${dbKey}:`, error.message || error);
    }
  } catch (e) {
    console.warn(`get_edge_credential exception for ${dbKey}:`, e);
  }

  return undefined;
}

async function readStoredCredential(supabase: any, dbKey: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc("get_edge_credential", {
      p_key: dbKey,
    });
    if (!error && typeof data === "string") return sanitizeCredential(data);
    if (error) {
      console.warn(`get_edge_credential failed for ${dbKey}:`, error.message || error);
    }
  } catch (e) {
    console.warn(`get_edge_credential exception for ${dbKey}:`, e);
  }
  return "";
}

async function readRazorpayCredentialSources(supabase: any) {
  return {
    envKeyId: Deno.env.get("RAZORPAY_KEY_ID"),
    envKeySecret: Deno.env.get("RAZORPAY_KEY_SECRET"),
    rpcKeyId: await readStoredCredential(supabase, "razorpay_key_id"),
    rpcKeySecret: await readStoredCredential(supabase, "razorpay_key_secret"),
  };
}

/** Razorpay key pair — complete env pair first, otherwise complete vault/admin pair. Never mix. */
export async function getRazorpayCredentials(supabase: any): Promise<{
  keyId: string;
  keySecret: string;
  source?: string;
}> {
  const selected = selectRazorpayKeyPair(await readRazorpayCredentialSources(supabase));
  return selected;
}

function logProbe(pair: RazorpayKeyPair, status: number) {
  console.log("[razorpay-credentials] probe", {
    source: pair.source,
    mode: razorpayKeyMode(pair.keyId),
    status,
    key_len: pair.keyId.length,
    secret_len: pair.keySecret.length,
  });
}

let cachedWorking: { pair: RazorpayKeyPair; until: number } | null = null;

/**
 * Probe Razorpay with each complete key pair. If platform env secrets are stale
 * or mixed, fall back to the vault/admin pair without mixing key_id and secret.
 */
export async function getWorkingRazorpayCredentials(
  supabase: any,
  fetchImpl: typeof fetch = fetch,
): Promise<RazorpayKeyPair> {
  const now = Date.now();
  if (cachedWorking && cachedWorking.until > now && cachedWorking.pair.keyId) {
    return cachedWorking.pair;
  }

  const candidates = razorpayKeyCandidates(await readRazorpayCredentialSources(supabase));
  if (candidates.length === 0) {
    return { keyId: "", keySecret: "", source: "" };
  }

  for (const pair of candidates) {
    try {
      const res = await fetchImpl("https://api.razorpay.com/v1/orders?count=1", {
        headers: {
          Authorization: `Basic ${btoa(`${pair.keyId}:${pair.keySecret}`)}`,
        },
      });
      logProbe(pair, res.status);
      if (res.ok || res.status === 429) {
        cachedWorking = { pair, until: now + 5 * 60 * 1000 };
        return pair;
      }
      if (res.status === 401 || res.status === 403) continue;
      cachedWorking = { pair, until: now + 60 * 1000 };
      return pair;
    } catch (error) {
      console.warn("[razorpay-credentials] probe failed", {
        source: pair.source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { keyId: "", keySecret: "", source: "rejected" };
}

export async function getRazorpayWebhookSecret(
  supabase: any
): Promise<string | null> {
  const secret = await getCredential(
    supabase,
    "razorpay_webhook_secret",
    "RAZORPAY_WEBHOOK_SECRET"
  );
  return secret && secret.trim().length > 0 ? secret : null;
}

/** Create a service-role Supabase client for credential lookups */
export function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
