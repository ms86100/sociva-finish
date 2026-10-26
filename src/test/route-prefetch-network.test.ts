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
    expect(missing).toContain(200);
    expect(missing).toContain(250);
    expect(missing).toContain(350);
    expect(missing).toContain(3000);

    vi.resetModules();
    setConnection({ saveData: false, effectiveType: '4g' });
    const fast = await scheduledTimeouts();
    expect(fast).toContain(200);
    expect(fast).toContain(250);
    expect(fast).toContain(350);
    expect(fast.length).toBe(15);
  });

  it('still prefetches on the native app even on 3g', async () => {
    platform.native = true;
    setConnection({ saveData: true, effectiveType: '3g' });
    const timeouts = await scheduledTimeouts();
    expect(timeouts).toContain(200);
    expect(timeouts).toContain(250);
    expect(timeouts).toContain(350);
    expect(timeouts.length).toBe(15);
  });

  it('warms Orders and Account chunks before secondary browse routes', async () => {
    setConnection({ saveData: false, effectiveType: '4g' });
    const timeouts = await scheduledTimeouts();
    const ordersAt = timeouts.indexOf(250);
    const profileAt = timeouts.indexOf(350);
    const exploreAt = timeouts.indexOf(600);
    expect(ordersAt).toBeGreaterThanOrEqual(0);
    expect(profileAt).toBeGreaterThanOrEqual(0);
    expect(exploreAt).toBeGreaterThanOrEqual(0);
    expect(ordersAt).toBeLessThan(exploreAt);
    expect(profileAt).toBeLessThan(exploreAt);
  });
});
