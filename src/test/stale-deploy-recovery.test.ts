import { describe, expect, it } from 'vitest';
import {
  BUILD_CACHE_VERSION,
  canAutoRecoverStaleDeploy,
  clearStaleDeployRecoveryMarks,
  isChunkLoadError,
  markStaleDeployRecoveryAttempt,
  staleDeployRecoveryCopy,
  withDeployRefreshParam,
} from '@/lib/stale-deploy-recovery';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('stale deploy recovery', () => {
  it('detects chunk / dynamic import failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 12 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Network offline'))).toBe(false);
  });

  it('limits auto-recovery attempts', () => {
    const store = new Map<string, string>();
    const api = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    expect(canAutoRecoverStaleDeploy(api)).toBe(true);
    markStaleDeployRecoveryAttempt(api);
    markStaleDeployRecoveryAttempt(api);
    expect(canAutoRecoverStaleDeploy(api)).toBe(false);
    clearStaleDeployRecoveryMarks(api);
    expect(canAutoRecoverStaleDeploy(api)).toBe(true);
  });

  it('uses calm update copy, not emergency error language', () => {
    for (const mode of ['updating', 'ready', 'manual'] as const) {
      const copy = staleDeployRecoveryCopy({ mode });
      expect(copy.title.toLowerCase()).not.toContain('wrong');
      expect(copy.body.toLowerCase()).not.toContain('old cached');
      expect(copy.primary.toLowerCase()).not.toContain('clear cache');
    }
  });

  it('bumps build cache version for one-time heal', () => {
    expect(BUILD_CACHE_VERSION).toContain('2026-11-10');
    expect(staleDeployRecoveryCopy({ mode: 'updating' }).title).toBe('Updating Sociva');
    const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toContain('BUILD_CACHE_VERSION');
    expect(main).toContain('staleDeployRecoveryCopy');
    expect(main).toContain('recoverFromStaleDeploy');
    expect(main).not.toMatch(/Clear Cache &amp; Retry|old cached version|Something went wrong/);
  });

  it('adds a refresh query without dropping the hash route', () => {
    const next = withDeployRefreshParam('https://sociva.in/?x=1#/cart', 123);
    expect(next).toContain('_sociva_refresh=123');
    expect(next).toContain('#/cart');
  });
});
