import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client for DB assertions in tests.
 * Uses anon key to also validate RLS policies.
 */
export function createDbClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || 'https://ywhlqsgvbkvcvqlsniad.supabase.co';
  const key = process.env.SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}

/**
 * Poll a condition until it returns truthy or timeout.
 */
export async function waitForCondition<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 10_000,
  intervalMs = 500
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
}
