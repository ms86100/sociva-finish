import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  startSentry: vi.fn(),
  captureSentryException: vi.fn(),
}));

vi.mock('@/lib/observability-sdk', () => sentry);

describe('deferred observability init', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example.ingest.sentry.io/1');
    sentry.startSentry.mockReset();
    sentry.captureSentryException.mockReset();
  });

  it('flushes captureException calls made before init', async () => {
    const mod = await import('@/lib/observability');
    const error = new Error('boot failed');
    mod.captureException(error, { source: 'bootstrap' });
    expect(sentry.captureSentryException).not.toHaveBeenCalled();

    expect(mod.initObservability()).toBe(true);

    await vi.waitFor(() => {
      expect(sentry.captureSentryException).toHaveBeenCalledWith(error, { source: 'bootstrap' });
    });
    expect(sentry.startSentry).toHaveBeenCalledWith('https://example.ingest.sentry.io/1');
  });

  it('drops queued exceptions when Sentry is not configured', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const mod = await import('@/lib/observability');
    mod.captureException(new Error('ignored'));
    expect(mod.initObservability()).toBe(false);
    await Promise.resolve();
    expect(sentry.startSentry).not.toHaveBeenCalled();
    expect(sentry.captureSentryException).not.toHaveBeenCalled();
  });
});
