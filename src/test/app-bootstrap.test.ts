import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Guards the single-request bootstrap that replaced ~8 separate static-config
 * queries on cold start. The whole point of this module is request count, so
 * that is what these tests assert.
 */

const rpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const PAYLOAD = {
  system_settings: [
    { key: 'currency_symbol', value: '₹' },
    { key: 'transit_statuses', value: 'picked_up,on_the_way' },
    // jsonb-typed rows must be normalised to strings
    { key: 'auto_cancel_grace_online_seconds', value: 1800 },
  ],
  admin_settings: [{ key: 'fulfillment_labels', value: '{"delivery":"Delivery"}' }],
  parent_groups: [{ slug: 'food', name: 'Food' }],
  category_config: [{ category: 'home_food', display_name: 'Home Food' }],
  badge_config: [{ tag_key: 'bestseller' }],
};

async function freshModule() {
  vi.resetModules();
  return import('@/lib/app-bootstrap');
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: PAYLOAD, error: null });
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('app bootstrap', () => {
  it('fetches all static config in a single RPC', async () => {
    const { loadAppBootstrap } = await freshModule();
    const boot = await loadAppBootstrap();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_app_bootstrap');
    expect(boot.sysMap.currency_symbol).toBe('₹');
    expect(boot.adminMap.fulfillment_labels).toBe('{"delivery":"Delivery"}');
    expect(boot.parentGroupRows).toHaveLength(1);
    expect(boot.categoryConfigRows).toHaveLength(1);
    expect(boot.badgeConfigRows).toHaveLength(1);
  });

  it('normalises non-string setting values to strings', async () => {
    const { loadAppBootstrap } = await freshModule();
    const boot = await loadAppBootstrap();
    expect(boot.sysMap.auto_cancel_grace_online_seconds).toBe('1800');
  });

  it('de-duplicates concurrent callers into ONE request', async () => {
    const { loadAppBootstrap } = await freshModule();

    // Simulates many config hooks mounting in the same tick.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => loadAppBootstrap())
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.sysMap.currency_symbol).toBe('₹');
  });

  it('serves a fresh cache without hitting the network again', async () => {
    const { loadAppBootstrap } = await freshModule();
    await loadAppBootstrap();
    await loadAppBootstrap();
    await loadAppBootstrap();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('persists the snapshot so a warm start needs zero requests', async () => {
    const first = await freshModule();
    await first.loadAppBootstrap();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('app-bootstrap-v4')).toBeTruthy();

    // New page load: module re-evaluates, localStorage survives.
    rpc.mockClear();
    const second = await freshModule();
    const boot = await second.loadAppBootstrap();

    expect(rpc).not.toHaveBeenCalled();
    expect(boot.sysMap.currency_symbol).toBe('₹');
  });

  it('returns a stale snapshot immediately and revalidates in the background', async () => {
    const stale = {
      sysMap: { currency_symbol: 'OLD' },
      adminMap: {},
      parentGroupRows: [],
      categoryConfigRows: [],
      badgeConfigRows: [],
      fetchedAt: Date.now() - 60 * 60 * 1000, // 1h old, past the 30m TTL
    };
    localStorage.setItem('app-bootstrap-v4', JSON.stringify(stale));

    const { loadAppBootstrap } = await freshModule();
    const boot = await loadAppBootstrap();

    // Served instantly from the stale snapshot...
    expect(boot.sysMap.currency_symbol).toBe('OLD');
    // ...while a refresh was kicked off.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('discards a snapshot that is older than the max persist age', async () => {
    localStorage.setItem(
      'app-bootstrap-v3',
      JSON.stringify({ sysMap: { currency_symbol: 'ANCIENT' }, fetchedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 })
    );

    const { loadAppBootstrap } = await freshModule();
    const boot = await loadAppBootstrap();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(boot.sysMap.currency_symbol).toBe('₹');
  });

  it('falls back to empty config instead of throwing when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    const { loadAppBootstrap } = await freshModule();

    const boot = await loadAppBootstrap();
    expect(boot.sysMap).toEqual({});
    expect(boot.categoryConfigRows).toEqual([]);
  });

  it('retries after a failure rather than caching the empty result', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    const { loadAppBootstrap } = await freshModule();

    await loadAppBootstrap();
    const second = await loadAppBootstrap();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(second.sysMap.currency_symbol).toBe('₹');
  });
});
