// @ts-nocheck
/**
 * Shared, cached status flow data for Live Activity lifecycle decisions.
 * Derives TERMINAL and START status sets from the DB-backed category_status_flows table.
 *
 * Three-tier fallback hierarchy (per set):
 *   1. Fresh DB data (within TTL)
 *   2. Expired in-memory cache (stale but valid)
 *   3. Persistent KV (survives app restart / cold start)
 *   4. Minimal safe fallback + critical warning
 */
import { supabase } from '@/integrations/supabase/client';
import { getString, setString } from '@/lib/persistent-kv';

/* ── Types ── */
interface FlowEntry {
  status_key: string;
  sort_order: number;
  is_terminal: boolean | null;
  starts_live_activity: boolean | null;
}

/* ── Cache state ── */
let cached: FlowEntry[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/* ── Persistent KV keys ── */
const KV_TERMINAL = 'status_flow_terminal_cache';
const KV_START = 'status_flow_start_cache';

/* ── Minimal safe fallbacks (NOT business logic — universal final state only) ── */
const SAFE_TERMINAL_FALLBACK = new Set<string>(['completed']);
const SAFE_START_FALLBACK = new Set<string>(); // empty is acceptable for start — LA just won't start

/* ── Helpers ── */

/** Read a Set<string> from persistent KV (JSON array). */
function readSetFromKV(key: string): Set<string> | null {
  try {
    const raw = getString(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return new Set<string>(arr);
  } catch { /* corrupt data — ignore */ }
  return null;
}

/** Persist a Set<string> to KV as JSON array. */
function writeSetToKV(key: string, set: Set<string>): void {
  try {
    setString(key, JSON.stringify([...set]));
  } catch { /* best-effort */ }
}

/* ── Core fetch ── */

export async function getStatusFlowEntries(): Promise<FlowEntry[]> {
  // Tier 1: fresh DB cache
  if (cached && Date.now() < cacheExpiry) return cached;

  const { data, error } = await supabase
    .from('category_status_flows')
    .select('status_key, sort_order, is_terminal, starts_live_activity')
    /* No transaction_type filter — support all current and future workflow types dynamically */
    .order('sort_order');

  if (!error && data && data.length > 0) {
    cached = data as FlowEntry[];
    cacheExpiry = Date.now() + CACHE_TTL;
    return cached;
  }

  // Tier 2: expired in-memory cache (stale but valid)
  if (cached) {
    console.warn('[statusFlowCache] DB fetch failed — using expired in-memory cache');
    return cached;
  }

  // Tier 3/4 handled per-set in getTerminalStatuses / getStartStatuses
  return [];
}

/** Statuses marked is_terminal in the DB — DB is the sole source of truth */
export async function getTerminalStatuses(): Promise<Set<string>> {
  const entries = await getStatusFlowEntries();
  const terminal = new Set<string>();
  for (const e of entries) {
    if (e.is_terminal) terminal.add(e.status_key);
  }

  if (terminal.size > 0) {
    // Persist last-known-good to KV for cold-start resilience
    writeSetToKV(KV_TERMINAL, terminal);
    return terminal;
  }

  // Tier 3: persistent KV (last successful DB fetch, survives app restart)
  const kvSet = readSetFromKV(KV_TERMINAL);
  if (kvSet) {
    console.warn('[statusFlowCache] No terminal statuses from DB — using persistent KV cache');
    return kvSet;
  }

  // Tier 4: minimal safe fallback — CRITICAL WARNING
  console.error('[statusFlowCache] CRITICAL: No terminal statuses from DB, cache, or KV — using safe fallback ["completed"]. This is a configuration issue.');
  return SAFE_TERMINAL_FALLBACK;
}

/** Statuses explicitly flagged starts_live_activity in the DB */
export async function getStartStatuses(): Promise<Set<string>> {
  const entries = await getStatusFlowEntries();
  const start = new Set<string>();
  for (const e of entries) {
    if (e.starts_live_activity) start.add(e.status_key);
  }

  if (start.size > 0) {
    // Persist last-known-good to KV
    writeSetToKV(KV_START, start);
    return start;
  }

  // Tier 3: persistent KV
  const kvSet = readSetFromKV(KV_START);
  if (kvSet) {
    console.warn('[statusFlowCache] No start statuses from DB — using persistent KV cache');
    return kvSet;
  }

  // Tier 4: empty is acceptable for start — LA simply won't start until DB loads
  console.warn('[statusFlowCache] No start statuses available — Live Activities will not start until DB loads');
  return SAFE_START_FALLBACK;
}

/** Invalidate cache (e.g. on app resume) */
export function invalidateStatusFlowCache(): void {
  cached = null;
  cacheExpiry = 0;
}
