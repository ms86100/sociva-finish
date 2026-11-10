/**
 * Web/PWA deploy recovery.
 * After a Vercel deploy, hashed chunks change. An old tab or Workbox cache can
 * request deleted assets and crash the shell. Recover quietly - never present
 * a "broken app" emergency screen as the first response.
 */

/** Bump on bootstrap / SW recovery changes so returning users drop stale caches once. */
export const BUILD_CACHE_VERSION = '2026-11-10-stale-deploy-heal';

export const STALE_RECOVERY_ATTEMPTS_KEY = 'stale-deploy-recoveries';
export const CHUNK_RELOAD_TS_KEY = 'chunk-reload-ts';
export const BUILD_CACHE_VERSION_KEY = 'app-build-cache-version';
export const BUILD_CACHE_RELOADED_KEY = 'build-cache-version-reloaded';

const MAX_AUTO_RECOVERIES = 2;

export function isChunkLoadError(error: unknown): boolean {
  const msg = String(
    (error as { message?: string })?.message || error || '',
  );
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed')
  );
}

export function staleDeployRecoveryAttempts(
  store: Pick<Storage, 'getItem'> = sessionStorage,
): number {
  return Number(store.getItem(STALE_RECOVERY_ATTEMPTS_KEY) || '0') || 0;
}

export function canAutoRecoverStaleDeploy(
  store: Pick<Storage, 'getItem'> = sessionStorage,
): boolean {
  return staleDeployRecoveryAttempts(store) < MAX_AUTO_RECOVERIES;
}

export function markStaleDeployRecoveryAttempt(
  store: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
): number {
  const next = staleDeployRecoveryAttempts(store) + 1;
  store.setItem(STALE_RECOVERY_ATTEMPTS_KEY, String(next));
  return next;
}

export function clearStaleDeployRecoveryMarks(
  store: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  store.removeItem(STALE_RECOVERY_ATTEMPTS_KEY);
  store.removeItem(CHUNK_RELOAD_TS_KEY);
  store.removeItem(BUILD_CACHE_RELOADED_KEY);
  store.removeItem('boot-fails');
}

/** Calm copy for update recovery - not an error / shame state. */
export function staleDeployRecoveryCopy(opts: {
  mode: 'updating' | 'ready' | 'manual';
}): { title: string; body: string; primary: string; secondary?: string } {
  if (opts.mode === 'updating') {
    return {
      title: 'Updating Sociva',
      body: 'A newer version is ready. This only takes a moment.',
      primary: 'Updating…',
    };
  }
  if (opts.mode === 'ready') {
    return {
      title: 'Update ready',
      body: 'Sociva has a newer version. Continue to load it.',
      primary: 'Continue',
    };
  }
  return {
    title: 'Finish update',
    body: 'One more step to load the latest Sociva. Your account stays signed in.',
    primary: 'Load latest version',
    secondary: 'Reset local data',
  };
}

/** Cache-bust navigation URL so the document is not served from a stale HTTP cache. */
export function withDeployRefreshParam(href: string, now = Date.now()): string {
  try {
    const url = new URL(href, 'https://sociva.in');
    url.searchParams.set('_sociva_refresh', String(now));
    // Preserve hash-router path when href is absolute or relative.
    if (href.includes('#')) {
      const hash = href.slice(href.indexOf('#'));
      return `${url.pathname}${url.search}${hash}`;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}_sociva_refresh=${now}`;
  }
}
