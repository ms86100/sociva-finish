import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  startAmplitude: vi.fn(),
  sdkTrack: vi.fn(),
  sdkIdentify: vi.fn(),
  sdkSetUserProperties: vi.fn(),
  sdkSetReplayOptIn: vi.fn(),
  sdkReset: vi.fn(),
}));

vi.mock('@/lib/analytics-sdk', () => sdk);
vi.mock('@/lib/analytics-facts', () => ({
  persistAnalyticsFact: vi.fn(async () => {}),
}));

describe('deferred analytics init', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_AMPLITUDE_API_KEY', 'test-key');
    sdk.startAmplitude.mockReset();
    sdk.sdkTrack.mockReset();
    sdk.sdkIdentify.mockReset();
    sdk.sdkSetUserProperties.mockReset();
    sdk.sdkSetReplayOptIn.mockReset();
    sdk.sdkReset.mockReset();
  });

  it('flushes track and identify calls made before init, after the SDK starts', async () => {
    const order: string[] = [];
    sdk.startAmplitude.mockImplementation(() => {
      order.push('start');
    });
    sdk.sdkTrack.mockImplementation(() => {
      order.push('track');
    });
    sdk.sdkIdentify.mockImplementation(() => {
      order.push('identify');
    });

    const mod = await import('@/lib/analytics');
    expect(mod.isAnalyticsEnabled()).toBe(false);
    mod.track('product_viewed', { product_id: 'p1' });
    mod.identify('user-1', { society_id: 'soc-1' });
    expect(sdk.sdkTrack).not.toHaveBeenCalled();
    expect(sdk.sdkIdentify).not.toHaveBeenCalled();

    expect(mod.initAnalytics()).toBe(true);

    await vi.waitFor(() => {
      expect(sdk.sdkTrack).toHaveBeenCalled();
      expect(sdk.sdkIdentify).toHaveBeenCalled();
    });

    expect(order).toEqual(['start', 'track', 'identify']);
    expect(sdk.startAmplitude).toHaveBeenCalledWith('test-key');
    expect(sdk.sdkTrack).toHaveBeenCalledWith(
      'product_viewed',
      expect.objectContaining({ product_id: 'p1' }),
    );
    expect(sdk.sdkIdentify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ society_id: 'soc-1' }),
      false,
    );
    expect(mod.isAnalyticsEnabled()).toBe(true);
  });

  it('drops queued calls when the API key is missing', async () => {
    vi.stubEnv('VITE_AMPLITUDE_API_KEY', '');
    const mod = await import('@/lib/analytics');
    mod.track('product_viewed', { product_id: 'p1' });
    expect(mod.initAnalytics()).toBe(false);
    await Promise.resolve();
    expect(sdk.startAmplitude).not.toHaveBeenCalled();
    expect(sdk.sdkTrack).not.toHaveBeenCalled();
    expect(mod.isAnalyticsEnabled()).toBe(false);
  });
});
