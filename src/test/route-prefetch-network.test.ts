import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
  },
}));

function setConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value,
  });
}

describe('route prefetch on slow connections', () => {
  beforeEach(() => {
    vi.resetModules();
    platform.native = false;
    setConnection(undefined);
    window.requestIdleCallback = vi.fn(() => 1) as unknown as typeof window.requestIdleCallback;
  });

  async function scheduledTimeouts(): Promise<number[]> {
    const ric = window.requestIdleCallback as unknown as ReturnType<typeof vi.fn>;
    ric.mockClear();
    const { prefetchBuyerRoutes } = await import('@/lib/route-prefetch');
    prefetchBuyerRoutes();
    return ric.mock.calls.map((call) => call[1]?.timeout);
  }

  it('skips prefetch for save-data, 2g, and 3g', async () => {
    setConnection({ saveData: true, effectiveType: '4g' });
    expect(await scheduledTimeouts()).toEqual([]);

    vi.resetModules();
    setConnection({ saveData: false, effectiveType: '2g' });
    expect(await scheduledTimeouts()).toEqual([]);

    vi.resetModules();
    setConnection({ saveData: false, effectiveType: 'slow-2g' });
    expect(await scheduledTimeouts()).toEqual([]);

    vi.resetModules();
    setConnection({ saveData: false, effectiveType: '3g' });
    expect(await scheduledTimeouts()).toEqual([]);
  });

  it('still prefetches when the connection type is missing or fast', async () => {
    setConnection(undefined);
    const missing = await scheduledTimeouts();
    expect(missing).toContain(400);
    expect(missing).toContain(3000);

    vi.resetModules();
    setConnection({ saveData: false, effectiveType: '4g' });
    const fast = await scheduledTimeouts();
    expect(fast).toContain(400);
    expect(fast.length).toBe(13);
  });

  it('still prefetches on the native app even on 3g', async () => {
    platform.native = true;
    setConnection({ saveData: true, effectiveType: '3g' });
    const timeouts = await scheduledTimeouts();
    expect(timeouts).toContain(400);
    expect(timeouts.length).toBe(13);
  });
});
