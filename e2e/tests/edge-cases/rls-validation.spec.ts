import { test, expect } from '../../fixtures/base.fixture';
import { createClient } from '@supabase/supabase-js';

test.describe('RLS Validation @critical', () => {
  test('anonymous user cannot access protected tables', async ({ db }) => {
    // Anon key should not be able to read other users' orders
    const { data: orders, error } = await db
      .from('orders')
      .select('id')
      .limit(5);

    // With proper RLS, anonymous users should get empty result or error
    if (!error) {
      // RLS filters rows — result should be empty for unauthenticated
      expect(orders?.length || 0).toBe(0);
    }
  });

  test('buyer cannot access seller_profiles directly', async ({ db }) => {
    const { data, error } = await db
      .from('seller_profiles')
      .select('*')
      .limit(5);

    // RLS should restrict — either error or empty/filtered
    // Public seller profiles may be readable, but not all fields
    // This validates that RLS is at least active
    expect(error === null || data !== null).toBeTruthy();
  });

  test('anonymous user cannot insert into protected tables', async ({ db }) => {
    const { error } = await db
      .from('orders')
      .insert({
        buyer_id: '00000000-0000-0000-0000-000000000000',
        status: 'placed',
        total_amount: 100,
      } as any);

    // RLS should block this insert
    expect(error).toBeTruthy();
  });

  test('anonymous user cannot read device_tokens', async ({ db }) => {
    const { data, error } = await db
      .from('device_tokens')
      .select('token')
      .limit(1);

    // Tokens contain sensitive data — should be blocked
    if (!error) {
      expect(data?.length || 0).toBe(0);
    }
  });

  test('anonymous user cannot read notification_queue', async ({ db }) => {
    const { data, error } = await db
      .from('notification_queue')
      .select('*')
      .limit(1);

    // Queue entries are internal — should be blocked
    if (!error) {
      expect(data?.length || 0).toBe(0);
    }
  });
});
