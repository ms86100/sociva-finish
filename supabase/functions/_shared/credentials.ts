import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

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
  const fromEnv = Deno.env.get(envKey);
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  try {
    const { data, error } = await supabase.rpc("get_edge_credential", {
      p_key: dbKey,
    });
    if (!error && typeof data === "string" && data.trim().length > 0) {
      return data;
    }
    if (error) {
      console.warn(`get_edge_credential failed for ${dbKey}:`, error.message || error);
    }
  } catch (e) {
    console.warn(`get_edge_credential exception for ${dbKey}:`, e);
  }

  return undefined;
}

/** Razorpay key pair — env first, then vault/DB via RPC */
export async function getRazorpayCredentials(supabase: any): Promise<{
  keyId: string;
  keySecret: string;
}> {
  const keyId =
    (await getCredential(supabase, "razorpay_key_id", "RAZORPAY_KEY_ID")) || "";
  const keySecret =
    (await getCredential(supabase, "razorpay_key_secret", "RAZORPAY_KEY_SECRET")) ||
    "";
  return { keyId, keySecret };
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
