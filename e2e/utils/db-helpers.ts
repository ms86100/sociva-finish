import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * Poll a condition until it returns truthy or timeout.
 */
async function poll<T>(
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
  throw new Error(`Poll timed out after ${timeoutMs}ms`);
}

/**
 * Fetch an order by ID from the database.
 */
export async function getOrder(db: SupabaseClient, orderId: string) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  if (error) throw new Error(`getOrder failed: ${error.message}`);
  return data;
}

/**
 * Wait for a notification_queue entry matching the order ID.
 */
export async function waitForNotification(
  db: SupabaseClient,
  orderId: string,
  timeoutMs = 10_000
) {
  return poll(async () => {
    const { data } = await db
      .from('notification_queue')
      .select('*')
      .contains('payload', { order_id: orderId })
      .limit(1)
      .maybeSingle();
    return data;
  }, timeoutMs);
}

/**
 * Get notification queue entries for an order.
 */
export async function getNotificationQueue(
  db: SupabaseClient,
  orderId: string
) {
  const { data, error } = await db
    .from('notification_queue')
    .select('*')
    .contains('payload', { order_id: orderId });
  if (error) throw new Error(`getNotificationQueue failed: ${error.message}`);
  return data || [];
}

/**
 * Get payment records for an order.
 */
export async function getPaymentRecord(
  db: SupabaseClient,
  orderId: string
) {
  const { data, error } = await db
    .from('payment_records')
    .select('*')
    .eq('order_id', orderId);
  if (error) throw new Error(`getPaymentRecord failed: ${error.message}`);
  return data || [];
}

/**
 * Assert exactly one order exists for a given idempotency check.
 * Used to detect duplicate orders.
 */
export async function assertSingleOrder(
  db: SupabaseClient,
  buyerId: string,
  afterTimestamp: string
) {
  const { data, error } = await db
    .from('orders')
    .select('id')
    .eq('buyer_id', buyerId)
    .gte('created_at', afterTimestamp);
  if (error) throw new Error(`assertSingleOrder failed: ${error.message}`);
  return data || [];
}

/**
 * Get push_logs entries for observability validation.
 */
export async function getOrderLogs(
  db: SupabaseClient,
  userId: string,
  afterTimestamp: string
) {
  const { data } = await db
    .from('push_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', afterTimestamp)
    .order('created_at', { ascending: false });
  return data || [];
}

/**
 * Wait for order status to reach expected value in DB.
 */
export async function waitForOrderStatus(
  db: SupabaseClient,
  orderId: string,
  expectedStatus: string,
  timeoutMs = 15_000
) {
  return poll(async () => {
    const { data } = await db
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();
    if (data?.status === expectedStatus) return data;
    return null;
  }, timeoutMs);
}
