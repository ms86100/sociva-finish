// @ts-nocheck
/**
 * Single-request app bootstrap.
 *
 * PERF: Before this existed, a cold app start fired ~8 separate Supabase
 * requests just for static reference data (system_settings, admin_settings,
 * parent_groups, category_config, badge_config, status labels, tracking
 * config). Every Supabase round-trip on this project costs ~0.5-1.0s of
 * fixed overhead regardless of payload size, so that fan-out alone was
 * ~8 seconds of dead time before any content could render.
 *
 * This module collapses all of it into ONE `get_app_bootstrap()` RPC
 * (~8.8 KB gzipped, ~1 round-trip) with:
 *   - in-flight de-duplication (concurrent callers share one request)
 *   - a TTL cache (this data changes rarely)
 *   - localStorage persistence with stale-while-revalidate, so a returning
 *     user's first paint needs zero config requests

 *
 * Every static-config hook delegates here. Do NOT add new direct queries
 * against these tables — extend the RPC instead.
 */
import { supabase } from '@/integrations/supabase/client';

export interface AppBootstrap {
  /** system_settings as a flat key -> value map */
  sysMap: Record<string, string>;
  /** admin_settings (active only) as a flat key -> value map */
  adminMap: Record<string, string>;
  parentGroupRows: any[];
  categoryConfigRows: any[];
  badgeConfigRows: any[];
  /** epoch ms when this snapshot was produced */
  fetchedAt: number;
}

export const EMPTY_BOOTSTRAP: AppBootstrap = {
  sysMap: {},
  adminMap: {},
  parentGroupRows: [],
  categoryConfigRows: [],
  badgeConfigRows: [],
  fetchedAt: 0,
};

/** Static reference data — safe to serve without revalidating for 30 minutes. */
const TTL_MS = 30 * 60 * 1000;

/**
 * Persisted snapshots older than this are discarded outright rather than being
 * served stale-while-revalidate. A day-old config is still fine to paint with;
 * a month-old one is not.
 */
const MAX_PERSIST_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Bump when the snapshot shape changes so old payloads are ignored. */
const STORAGE_KEY = 'app-bootstrap-v2';

let cache: AppBootstrap | null = null;
let inflight: Promise<AppBootstrap> | null = null;

function toMap(rows: any[] | null | undefined): Record<string, string> {
  // Lazy import avoided — keep bootstrap free of circular deps; inline unwrap.
  const map: Record<string, string> = {};
  for (const row of rows || []) {
    if (row?.key == null || row?.value == null) continue;
    // system_settings.value is jsonb (string/number) — always flatten to plain text.
    const v = row.value;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
          map[row.key] = String(parsed);
          continue;
        }
      } catch {
        // plain string
      }
      map[row.key] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      map[row.key] = String(v);
    } else {
      map[row.key] = JSON.stringify(v);
    }
  }
  return map;
}

function normalise(raw: any): AppBootstrap {
  return {
    sysMap: toMap(raw?.system_settings),
    adminMap: toMap(raw?.admin_settings),
    parentGroupRows: Array.isArray(raw?.parent_groups) ? raw.parent_groups : [],
    categoryConfigRows: Array.isArray(raw?.category_config) ? raw.category_config : [],
    badgeConfigRows: Array.isArray(raw?.badge_config) ? raw.badge_config : [],
    fetchedAt: Date.now(),
  };
}

function isFresh(snapshot: AppBootstrap | null): boolean {
  return !!snapshot && Date.now() - snapshot.fetchedAt < TTL_MS;
}

function readPersisted(): AppBootstrap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppBootstrap;
    if (!parsed?.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > MAX_PERSIST_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { ...EMPTY_BOOTSTRAP, ...parsed };
  } catch {
    return null;
  }
}

function writePersisted(snapshot: AppBootstrap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or private-mode failure — the in-memory cache still works.
  }
}

// Prime synchronously at module load so the very first render of a returning
// user has all static config available with zero network requests.
cache = readPersisted();

async function fetchFresh(): Promise<AppBootstrap> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_app_bootstrap' as any);
      if (error) throw error;
      const next = normalise(data);
      cache = next;
      writePersisted(next);
      return next;
    } catch (e) {
      console.error('[bootstrap] get_app_bootstrap failed:', e);
      // Serve whatever we have rather than blanking the UI. `fetchedAt` is left
      // untouched so the next caller retries instead of being pinned to a
      // failed empty result.
      return cache ?? EMPTY_BOOTSTRAP;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Load the bootstrap snapshot.
 *
 * - Fresh cache -> returned immediately, no network.
 * - Stale cache -> returned immediately AND refreshed in the background
 *   (stale-while-revalidate), so a warm start never blocks on the network.
 * - No cache -> awaits one request.
 *
 * Concurrent callers share the same in-flight promise, so N hooks mounting in
 * the same tick still produce exactly ONE request.
 */
export async function loadAppBootstrap(force = false): Promise<AppBootstrap> {
  if (force) return fetchFresh();
  if (isFresh(cache)) return cache!;

  if (cache) {
    // Stale but usable: revalidate in the background, return now.
    void fetchFresh();
    return cache;
  }

  return fetchFresh();
}

/** Synchronous read — returns null when nothing has loaded or been persisted. */
export function peekAppBootstrap(): AppBootstrap | null {
  return cache;
}

/** Force the next read to hit the network (call after admin config edits). */
export function invalidateAppBootstrap(): void {
  cache = null;
  inflight = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

