/**
 * Resolves the Supabase project used by integration tests from the
 * environment (.env → VITE_SUPABASE_*), so tests always target the
 * project this app is actually connected to.
 *
 * Previously each test file hardcoded a stale project ref + anon key,
 * which made every integration suite hit a foreign/dead backend.
 */
const env: Record<string, string | undefined> = {
  ...(typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {}),
  ...((import.meta as any).env ?? {}),
};

export const SUPABASE_URL: string =
  env.VITE_SUPABASE_URL ||
  (env.VITE_SUPABASE_PROJECT_ID ? `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');

export const SUPABASE_ANON_KEY: string =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';

export const SUPABASE_PROJECT_ID: string =
  env.VITE_SUPABASE_PROJECT_ID || SUPABASE_URL.replace(/^https:\/\//, '').split('.')[0] || '';

/** True when the env carries enough config to reach a Supabase backend. */
export const hasSupabaseEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
}
