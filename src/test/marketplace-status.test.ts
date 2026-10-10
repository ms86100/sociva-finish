import { describe, it, expect } from 'vitest';
import { resolveMarketplaceStatus } from '@/lib/marketplace-status';

const base = {
  hasContent: false,
  isLoading: false,
  hasLocation: true,
  locationPending: false,
  isPaused: false,
  isError: false,
};

describe('resolveMarketplaceStatus', () => {
  it('keeps showing loaded marketplace data when a background refresh fails or goes offline', () => {
    expect(resolveMarketplaceStatus({ ...base, hasContent: true, isError: true })).toBe('content');
    expect(resolveMarketplaceStatus({ ...base, hasContent: true, isPaused: true })).toBe('content');
  });

  it('shows loading while the first fetch runs', () => {
    expect(resolveMarketplaceStatus({ ...base, isLoading: true })).toBe('loading');
  });

  it('waits for the profile before deciding location is missing', () => {
    expect(resolveMarketplaceStatus({ ...base, hasLocation: false, locationPending: true })).toBe('loading');
    expect(resolveMarketplaceStatus({ ...base, hasLocation: false })).toBe('no-location');
  });

  it('separates offline, failed and genuinely empty', () => {
    expect(resolveMarketplaceStatus({ ...base, isPaused: true })).toBe('offline');
    expect(resolveMarketplaceStatus({ ...base, isError: true })).toBe('error');
    expect(resolveMarketplaceStatus(base)).toBe('empty');
  });

  it('never reports a failed request as an empty marketplace', () => {
    const failed = resolveMarketplaceStatus({ ...base, isError: true });
    expect(failed).not.toBe('empty');
  });
});
