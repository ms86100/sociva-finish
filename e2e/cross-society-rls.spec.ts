/**
 * Cross-society RLS checks against staging Supabase REST (no browser).
 *
 * Required env:
 *   STAGING_URL or SUPABASE_URL   - e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY             - project anon key
 *
 * Optional (for full cross-society matrix):
 *   SUPABASE_SERVICE_ROLE_KEY     - probe society B row ids
 *   CROSS_SOCIETY_USER_A_JWT      - society A user access token (skips password sign-in)
 *   CROSS_SOCIETY_USER_B_JWT      - society B user (used for seed discovery only)
 *   TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD - default society A (integration seller)
 *   TEST_BUYER_EMAIL / TEST_BUYER_PASSWORD   - default society B (integration buyer)
 *
 * Run: cd e2e && npx playwright test cross-society-rls.spec.ts --project=cross-society-rls
 *
 * TODO: seed dedicated society A/B fixtures via seed-integration-test-users when not on staging.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (
  process.env.STAGING_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');

const anonKey = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

function requireUrl(): string {
  if (!supabaseUrl || !anonKey) {
    test.skip(
      true,
      'Set STAGING_URL (or SUPABASE_URL) and SUPABASE_ANON_KEY for cross-society RLS.',
    );
  }
  return supabaseUrl;
}

async function restSelect(
  baseUrl: string,
  apikey: string,
  bearer: string,
  table: string,
  query: string,
): Promise<{ status: number; rows: unknown[]; errorText: string | null }> {
  const url = `${baseUrl}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return { status: res.status, rows: [], errorText: text };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return {
      status: res.status,
      rows: Array.isArray(parsed) ? parsed : [],
      errorText: null,
    };
  } catch {
    return { status: res.status, rows: [], errorText: 'invalid_json' };
  }
}

async function resolveUserJwt(): Promise<string | null> {
  const preset = process.env.CROSS_SOCIETY_USER_A_JWT?.trim();
  if (preset) return preset;

  const email =
    process.env.TEST_SELLER_EMAIL?.trim() || 'integration-seller@test.sociva.com';
  const password =
    process.env.TEST_SELLER_PASSWORD?.trim() || 'TestSeller2026!';

  const client = createClient(requireUrl(), anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

type SocietyBProbe = {
  societyAId: string;
  societyBId: string;
  orderIds: string[];
  chatIds: string[];
  addressIds: string[];
  deviceTokenIds: string[];
  walletUserIds: string[];
};

async function probeSocietyBRows(baseUrl: string): Promise<SocietyBProbe | null> {
  if (!serviceKey) return null;

  const admin = createClient(baseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: societies } = await admin
    .from('societies')
    .select('id, slug')
    .in('slug', ['integration-test-society', 'integration-test-society-2']);

  const societyA = societies?.find((s) => s.slug === 'integration-test-society');
  const societyB = societies?.find((s) => s.slug === 'integration-test-society-2');
  if (!societyA?.id || !societyB?.id) return null;

  const { data: profilesB } = await admin
    .from('profiles')
    .select('id')
    .eq('society_id', societyB.id)
    .limit(5);

  const userBIds = (profilesB || []).map((p) => p.id as string);
  if (userBIds.length === 0) return null;

  const { data: ordersB } = await admin
    .from('orders')
    .select('id')
    .or(
      `buyer_society_id.eq.${societyB.id},seller_society_id.eq.${societyB.id}`,
    )
    .limit(10);

  const { data: chatsB } = await admin
    .from('chat_messages')
    .select('id')
    .in('sender_id', userBIds)
    .limit(10);

  const { data: addressesB } = await admin
    .from('delivery_addresses')
    .select('id')
    .in('user_id', userBIds)
    .limit(10);

  const { data: tokensB } = await admin
    .from('device_tokens')
    .select('id')
    .in('user_id', userBIds)
    .limit(10);

  return {
    societyAId: societyA.id,
    societyBId: societyB.id,
    orderIds: (ordersB || []).map((r) => r.id as string),
    chatIds: (chatsB || []).map((r) => r.id as string),
    addressIds: (addressesB || []).map((r) => r.id as string),
    deviceTokenIds: (tokensB || []).map((r) => r.id as string),
    walletUserIds: userBIds,
  };
}

function inFilter(column: string, ids: string[]): string {
  if (ids.length === 0) return `${column}=eq.00000000-0000-0000-0000-000000000000`;
  return `${column}=in.(${ids.join(',')})`;
}

test.describe('Cross-society RLS @critical', () => {
  test('variant gate tables block anon REST select', async () => {
    const base = requireUrl();
    for (const table of ['_variant_gate_backup', '_variant_gate_scripts']) {
      const { status, rows, errorText } = await restSelect(
        base,
        anonKey,
        anonKey,
        table,
        'select=*&limit=1',
      );
      const blocked = status === 401 || status === 403 || !!errorText || rows.length === 0;
      expect(blocked, `${table} should not leak to anon`).toBeTruthy();
    }
  });

  test('unauthenticated REST cannot read orders (RLS enabled)', async () => {
    const base = requireUrl();
    const { rows, errorText, status } = await restSelect(
      base,
      anonKey,
      anonKey,
      'orders',
      'select=id&limit=5',
    );
    const blocked =
      status === 401 || !!errorText || rows.length === 0;
    expect(blocked, 'orders must not be readable without user JWT').toBeTruthy();
  });

  test('society A user cannot read society B rows without scope', async () => {
    const base = requireUrl();
    const userJwt = await resolveUserJwt();
    const probe = await probeSocietyBRows(base);

    if (!userJwt || !probe) {
      test.info().annotations.push({
        type: 'TODO',
        description:
          'Seed integration-test-society users and SUPABASE_SERVICE_ROLE_KEY for full cross-society matrix.',
      });
      test.skip(
        true,
        'No society A JWT or society B probe data - baseline RLS tests still run above.',
      );
      return;
    }

    const tables: Array<{
      name: string;
      query: string;
      skipEmptyProbe?: boolean;
    }> = [
      {
        name: 'orders',
        query: `select=id&${inFilter('id', probe.orderIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'chat_messages',
        query: `select=id&${inFilter('id', probe.chatIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'delivery_addresses',
        query: `select=id&${inFilter('id', probe.addressIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'device_tokens',
        query: `select=id&${inFilter('id', probe.deviceTokenIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'buyer_wallets',
        query: `select=user_id&${inFilter('user_id', probe.walletUserIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'wallet_credit_lots',
        query: `select=id&${inFilter('user_id', probe.walletUserIds)}`,
        skipEmptyProbe: true,
      },
      {
        name: 'wallet_ledger_txns',
        query: `select=id&${inFilter('user_id', probe.walletUserIds)}`,
        skipEmptyProbe: true,
      },
    ];

    for (const t of tables) {
      const { rows, errorText } = await restSelect(
        base,
        anonKey,
        userJwt,
        t.name,
        t.query,
      );
      if (t.skipEmptyProbe && t.query.includes('00000000-0000-0000-0000-000000000000')) {
        test.info().annotations.push({
          type: 'note',
          description: `No society B seed rows for ${t.name} - skipped row assertion`,
        });
        continue;
      }
      const isolated = !!errorText || rows.length === 0;
      expect(
        isolated,
        `${t.name}: society A user must not read society B rows (${rows.length} leaked)`,
      ).toBeTruthy();
    }

    const broadOrders = await restSelect(
      base,
      anonKey,
      userJwt,
      'orders',
      `select=id,buyer_society_id,seller_society_id&limit=200`,
    );
    const leaked = broadOrders.rows.filter((row) => {
      const r = row as {
        buyer_society_id?: string;
        seller_society_id?: string;
      };
      const onlySocietyB =
        (r.buyer_society_id === probe.societyBId ||
          r.seller_society_id === probe.societyBId) &&
        r.buyer_society_id !== probe.societyAId &&
        r.seller_society_id !== probe.societyAId;
      return onlySocietyB;
    });
    expect(
      leaked.length,
      'Unscoped orders select must not return society-B-only rows for society A user',
    ).toBe(0);
  });
});