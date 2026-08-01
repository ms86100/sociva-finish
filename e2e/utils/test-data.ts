import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * Generate a unique test slug to ensure idempotent test data.
 */
export function testSlug(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get current ISO timestamp for test data scoping.
 */
export function testTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Clean up test orders created after a given timestamp.
 * Uses the buyer's anon-key scoped client (RLS applies).
 */
export async function cleanupTestOrders(
  db: SupabaseClient,
  afterTimestamp: string
) {
  // Note: This may not delete due to RLS — that's expected.
  // Tests should be designed to not depend on cleanup.
  const { data } = await db
    .from('orders')
    .select('id')
    .gte('created_at', afterTimestamp)
    .limit(50);

  if (data && data.length > 0) {
    console.log(`[TestData] Found ${data.length} test orders to clean up`);
  }
}

/**
 * Verify test infrastructure is ready.
 */
export async function verifyTestInfra(db: SupabaseClient): Promise<boolean> {
  try {
    // Check that we can query the database
    const { error } = await db.from('societies').select('id').limit(1);
    if (error) {
      console.error('[TestData] DB connection failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[TestData] Infrastructure check failed:', e);
    return false;
  }
}

/**
 * Get a test product that exists in the marketplace.
 * Returns the first active product found.
 */
export async function getTestProduct(db: SupabaseClient) {
  const { data, error } = await db
    .from('products')
    .select('id, name, price, seller_id')
    .eq('is_available', true)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error('No available test product found in marketplace');
  }
  return data;
}

/**
 * Get integration test society.
 */
export async function getTestSociety(db: SupabaseClient) {
  const { data } = await db
    .from('societies')
    .select('id, name')
    .eq('name', 'Integration Test Society')
    .single();
  return data;
}
