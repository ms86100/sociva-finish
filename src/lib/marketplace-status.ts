/**
 * Which top-level state the Home marketplace should render.
 *
 * Only `empty` means "the request succeeded and there are genuinely no
 * eligible listings". Failures, missing location and offline must never fall
 * through to it, or a network problem looks like a dead marketplace.
 */
export type MarketplaceStatus = 'content' | 'loading' | 'no-location' | 'offline' | 'error' | 'empty';

export interface MarketplaceStatusInput {
  /** Products are available to render (fresh or previously loaded). */
  hasContent: boolean;
  /** A first load (or its retry) is in flight. */
  isLoading: boolean;
  /** Browsing coordinates are known, so discovery queries can run. */
  hasLocation: boolean;
  /** Coordinates may still arrive (profile / society still loading). */
  locationPending: boolean;
  /** React Query paused the fetch because the device reports offline. */
  isPaused: boolean;
  /** The last fetch attempt failed. */
  isError: boolean;
}

export function resolveMarketplaceStatus(input: MarketplaceStatusInput): MarketplaceStatus {
  if (input.hasContent) return 'content';
  if (input.isLoading) return 'loading';
  if (!input.hasLocation) return input.locationPending ? 'loading' : 'no-location';
  if (input.isPaused) return 'offline';
  if (input.isError) return 'error';
  return 'empty';
}
