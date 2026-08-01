import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Read a credential from admin_settings table first, fall back to Deno env secret.
 * This ensures credentials saved via the Admin Panel take precedence.
 */
export async function getCredential(
  supabase: any,
  dbKey: string,
  envKey: string
): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from("admin_settings")
      .select("value, is_active")
      .eq("key", dbKey)
      .maybeSingle();
    if (data?.value && data.is_active !== false) return data.value;
  } catch (e) {
    console.warn(`DB credential lookup failed for ${dbKey}:`, e);
  }
  return Deno.env.get(envKey);
}

/** Create a service-role Supabase client for credential lookups */
export function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
