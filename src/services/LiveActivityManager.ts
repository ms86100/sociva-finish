// @ts-nocheck
import { Capacitor } from '@capacitor/core';
import { LiveActivity } from '@/plugins/live-activity';
import type { LiveActivityData } from '@/plugins/live-activity/definitions';
import { getString, setString, removeKey } from '@/lib/persistent-kv';
import { recordLAError } from '@/services/liveActivityDiagnostics';
import { supabase } from '@/integrations/supabase/client';
import { getTerminalStatuses, getStartStatuses } from '@/services/statusFlowCache';

const TAG = '[LiveActivity]';
const OPS_LOG_KEY = 'live_activity_ops_log';
const MAX_OPS_LOG = 50;

export interface OperationLogEntry {
  timestamp: number;
  action: 'start' | 'update' | 'end' | 'end_all';
  entityId: string;
  status?: string;
  success: boolean;
  error?: string;
  activityId?: string;
}

/** In-memory operation log, persisted to KV */
const operationLog: OperationLogEntry[] = (() => {
  try {
    const raw = getString(OPS_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
})();

function addOpsEntry(entry: OperationLogEntry) {
  operationLog.push(entry);
  if (operationLog.length > MAX_OPS_LOG) operationLog.splice(0, operationLog.length - MAX_OPS_LOG);
  try { setString(OPS_LOG_KEY, JSON.stringify(operationLog)); } catch { /* best-effort */ }
}

export function getOperationLog(): OperationLogEntry[] {
  return [...operationLog];
}

/** DB-backed terminal and start status sets — loaded via three-tier fallback in statusFlowCache. */
let TERMINAL_STATUSES = new Set<string>();
let START_STATUSES = new Set<string>();

async function loadStatusSets(): Promise<void> {
  // Always re-fetch — if previous load got safe fallback, this allows upgrade to real data
  try {
    const [terminal, start] = await Promise.all([getTerminalStatuses(), getStartStatuses()]);
    TERMINAL_STATUSES = terminal;
    START_STATUSES = start;
  } catch (e) {
    console.error(TAG, 'CRITICAL: Failed to load status sets — using current fallback sets', e);
  }
}

const THROTTLE_MS = 5_000;
const STORAGE_KEY = 'live_activity_map';
const MAX_ACTIVE = 10;

interface ActiveEntry {
  activityId: string;
  entityId: string;
  lastUpdate: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  lastStatus: string | null;
}

interface PersistedMap {
  version: number;
  activities: Record<string, string>; // entityId → activityId
}

/**
 * Singleton manager that coordinates lock-screen live activities.
 */
class _LiveActivityManager {
  private active = new Map<string, ActiveEntry>();
  private hydrationPromise: Promise<void> | null = null;
  private hydrating = false;
  private starting = new Set<string>();
  private canStart = true;

  /** Tracks which entityIds have had their push token saved */
  private tokenSaved = new Set<string>();

  /** Listener cleanup */
  private tokenListenerSetup = false;

  private get isSupported(): boolean {
    return Capacitor.isNativePlatform();
  }

  // ── Push Token Listener ──────────────────────────────────

  private setupTokenListener(): void {
    if (this.tokenListenerSetup || !this.isSupported) return;
    this.tokenListenerSetup = true;

    try {
      LiveActivity.addListener?.('liveActivityPushToken', async (event: { entityId: string; pushToken: string }) => {
        const { entityId, pushToken } = event;
        console.log(TAG, `PUSH TOKEN received for entity=${entityId} token=${pushToken.substring(0, 16)}…`);

        if (this.tokenSaved.has(entityId)) {
          console.log(TAG, `PUSH TOKEN already saved for ${entityId}, skipping`);
          return;
        }

        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            console.warn(TAG, 'PUSH TOKEN — no authenticated user, skipping save');
            return;
          }

          const { error } = await supabase
            .from('live_activity_tokens')
            .upsert({
              user_id: user.id,
              order_id: entityId,
              push_token: pushToken,
              platform: 'ios',
            }, { onConflict: 'order_id,platform' });

          if (error) {
            console.error(TAG, `PUSH TOKEN save failed: ${error.message}`);
          } else {
            this.tokenSaved.add(entityId);
            console.log(TAG, `PUSH TOKEN saved for entity=${entityId}`);
          }
        } catch (e) {
          console.error(TAG, 'PUSH TOKEN save exception:', e);
        }
      });
    } catch (e) {
      console.warn(TAG, 'Failed to setup token listener (web?):', e);
    }
  }

  // ── Persistence ──────────────────────────────────────────

  private loadPersistedMap(): Record<string, string> {
    try {
      const raw = getString(STORAGE_KEY);
      if (!raw) return {};
      const parsed: PersistedMap = JSON.parse(raw);
      if (parsed.version !== 1) return {};
      return parsed.activities ?? {};
    } catch {
      return {};
    }
  }

  private persistMap(): void {
    const activities: Record<string, string> = {};
    for (const [entityId, entry] of this.active) {
      activities[entityId] = entry.activityId;
    }
    const data: PersistedMap = { version: 1, activities };
    setString(STORAGE_KEY, JSON.stringify(data));
  }

  private clearPersistedMap(): void {
    removeKey(STORAGE_KEY);
  }

  // ── Hydration & Cleanup ──────────────────────────────────

  private async hydrate(): Promise<void> {
    if (!this.hydrationPromise) {
      this.hydrationPromise = this._doHydrate();
    }
    return this.hydrationPromise;
  }

  private async _doHydrate(): Promise<void> {
    this.hydrating = true;
    console.log(TAG, 'HYDRATE START — reconciling persisted + native state');

    this.setupTokenListener();

    // Load DB-backed status sets at hydration time
    await loadStatusSets();

    try {
      const persisted = this.loadPersistedMap();
      const persistedCount = Object.keys(persisted).length;
      console.log(TAG, `HYDRATE persisted entries: ${persistedCount}`);

      for (const [entityId, activityId] of Object.entries(persisted)) {
        if (!this.active.has(entityId)) {
          this.active.set(entityId, {
            activityId,
            entityId,
            lastUpdate: Date.now(),
            pendingTimer: null,
            lastStatus: null,
          });
        }
      }

      const { activities } = await LiveActivity.getActiveActivities();
      console.log(TAG, `HYDRATE native activities: ${activities.length}`);

      // ── DEDUP: group native activities by entityId, keep latest, end duplicates ──
      const byEntity = new Map<string, { activityId: string; entityId: string }[]>();
      for (const act of activities) {
        const list = byEntity.get(act.entityId) ?? [];
        list.push(act);
        byEntity.set(act.entityId, list);
      }

      const nativeEntityIds = new Set<string>();

      for (const [entityId, acts] of byEntity) {
        nativeEntityIds.add(entityId);

        // If multiple native activities for same entity → end all but the last
        if (acts.length > 1) {
          console.warn(TAG, `HYDRATE DEDUP — ${acts.length} activities for entity=${entityId}, keeping last`);
          const toEnd = acts.slice(0, -1);
          const keeper = acts[acts.length - 1];
          for (const stale of toEnd) {
            try {
              await LiveActivity.endLiveActivity({ activityId: stale.activityId });
              console.log(TAG, `HYDRATE DEDUP ended stale activityId=${stale.activityId}`);
            } catch (e) {
              console.warn(TAG, `HYDRATE DEDUP end failed:`, e);
            }
          }
          this.active.set(entityId, {
            activityId: keeper.activityId,
            entityId,
            lastUpdate: Date.now(),
            pendingTimer: null,
            lastStatus: null,
          });
        } else {
          const act = acts[0];
          const existing = this.active.get(entityId);
          if (!existing) {
            this.active.set(entityId, {
              activityId: act.activityId,
              entityId,
              lastUpdate: Date.now(),
              pendingTimer: null,
              lastStatus: null,
            });
          } else if (existing.activityId !== act.activityId) {
            existing.activityId = act.activityId;
          }
        }
      }

      // Remove entries that exist in our map but not natively
      for (const [entityId] of this.active) {
        if (!nativeEntityIds.has(entityId)) {
          console.log(TAG, `HYDRATE removing stale entry: ${entityId}`);
          this.active.delete(entityId);
        }
      }

      const validIds = Array.from(this.active.keys());
      await LiveActivity.cleanupStaleActivities({ validEntityIds: validIds });

      this.persistMap();
      this.canStart = true;
      console.log(TAG, `HYDRATE COMPLETE — tracking ${this.active.size} activities`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(TAG, 'HYDRATE FAILED:', msg);

      if (msg.includes('not implemented') || msg.includes('not enabled') || msg.includes('not available')) {
        this.canStart = false;
        console.warn(TAG, 'HYDRATE — native Live Activities not available, disabling starts');
      }
    } finally {
      this.hydrating = false;
    }
  }

  // ── Map size guard ───────────────────────────────────────

  private enforceMaxActive(): void {
    if (this.active.size <= MAX_ACTIVE) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [entityId, entry] of this.active) {
      if (entry.lastUpdate < oldestTime) {
        oldestTime = entry.lastUpdate;
        oldestKey = entityId;
      }
    }
    if (oldestKey) {
      console.log(TAG, `MAX_ACTIVE exceeded, evicting oldest: ${oldestKey}`);
      void this.end(oldestKey);
    }
  }

  // ── Public API ───────────────────────────────────────────

  /** Start or update a live activity based on workflow status */
  async push(data: LiveActivityData): Promise<void> {
    console.log(TAG, `TRIGGER entity=${data.entity_id} status=${data.workflow_status} native=${this.isSupported}`);

    if (!this.isSupported) {
      console.log(TAG, 'SKIP — not a native platform');
      return;
    }

    await this.hydrate();

    if (!this.canStart) {
      console.log(TAG, 'SKIP — native Live Activities not available');
      return;
    }

    const { entity_id, workflow_status } = data;

    // Terminal → end activity
    if (TERMINAL_STATUSES.has(workflow_status)) {
      console.log(TAG, `END (terminal) entity=${entity_id} status=${workflow_status}`);
      await this.end(entity_id);
      return;
    }

    const existing = this.active.get(entity_id);

    // No active entry and status qualifies → start
    if (!existing && START_STATUSES.has(workflow_status)) {
      if (this.starting.has(entity_id)) {
        console.log(TAG, `SKIP — start already in-flight for ${entity_id}`);
        return;
      }

      // Re-check after hydration — hydration may have populated it
      const hydrated = this.active.get(entity_id);
      if (hydrated) {
        console.log(TAG, `POST-HYDRATE: entity=${entity_id} already active, updating instead of starting`);
        this.throttledUpdate(hydrated, data);
        return;
      }

      this.starting.add(entity_id);
      try {
        // Native-layer dedup: check if a native activity already exists for this entity
        // (e.g. survived an app kill but wasn't in our persisted map)
        const { activities: nativeActivities } = await LiveActivity.getActiveActivities();
        const nativeMatch = nativeActivities.find((a) => a.entityId === entity_id);
        if (nativeMatch) {
          console.log(TAG, `NATIVE DEDUP: activity already exists for ${entity_id}, updating`);
          this.active.set(entity_id, {
            activityId: nativeMatch.activityId,
            entityId: entity_id,
            lastUpdate: Date.now(),
            pendingTimer: null,
            lastStatus: workflow_status,
          });
          this.persistMap();
          await LiveActivity.updateLiveActivity(data);
          addOpsEntry({ timestamp: Date.now(), action: 'update', entityId: entity_id, status: workflow_status, success: true });
          return;
        }

        console.log(TAG, `START entity=${entity_id} status=${workflow_status}`);
        const { activityId } = await LiveActivity.startLiveActivity(data);
        console.log(TAG, `START SUCCESS entity=${entity_id} activityId=${activityId}`);
        this.active.set(entity_id, {
          activityId,
          entityId: entity_id,
          lastUpdate: Date.now(),
          pendingTimer: null,
          lastStatus: workflow_status,
        });
        this.persistMap();
        this.enforceMaxActive();
        addOpsEntry({ timestamp: Date.now(), action: 'start', entityId: entity_id, status: workflow_status, success: true, activityId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('not authorized') || msg.includes('not allowed') || msg.includes('denied')) {
          this.canStart = false;
          console.warn(TAG, 'Permission denied — disabling future starts');
        }
        recordLAError('START', entity_id, e);
        addOpsEntry({ timestamp: Date.now(), action: 'start', entityId: entity_id, status: workflow_status, success: false, error: msg });
      } finally {
        this.starting.delete(entity_id);
      }
      return;
    }

    // Active entry exists → update
    if (existing) {
      // Status change = high-priority: bypass throttle for instant Dynamic Island update
      const statusChanged = existing.lastStatus !== null && existing.lastStatus !== workflow_status;
      if (statusChanged) {
        console.log(TAG, `UPDATE (INSTANT — status changed ${existing.lastStatus} → ${workflow_status}) entity=${entity_id}`);
        this.doUpdate(existing, data);
      } else {
        console.log(TAG, `UPDATE (throttled) entity=${entity_id} status=${workflow_status}`);
        this.throttledUpdate(existing, data);
      }
    } else {
      console.log(TAG, `SKIP — no active entry and status '${workflow_status}' not in START_STATUSES`);
    }
  }

  /** End the live activity for an entity */
  async end(entityId: string): Promise<void> {
    const entry = this.active.get(entityId);
    if (!entry) {
      console.log(TAG, `END — no active entry for ${entityId}, trying native fallback`);
      // Bug 2 fix: fallback to native layer for cold-restart desync
      try {
        const { activities } = await LiveActivity.getActiveActivities();
        const match = activities.find(a => a.entityId === entityId);
        if (match) {
          console.log(TAG, `END NATIVE FALLBACK — found native activity ${match.activityId} for ${entityId}`);
          await LiveActivity.endLiveActivity({ activityId: match.activityId });
          this.deleteTokenFromBackend(entityId);
          addOpsEntry({ timestamp: Date.now(), action: 'end', entityId, success: true, activityId: match.activityId });
        }
      } catch { /* best-effort */ }
      return;
    }

    if (entry.pendingTimer) clearTimeout(entry.pendingTimer);
    this.active.delete(entityId);
    this.tokenSaved.delete(entityId);
    this.persistMap();

    this.deleteTokenFromBackend(entityId);

    try {
      console.log(TAG, `END entity=${entityId} activityId=${entry.activityId}`);
      await LiveActivity.endLiveActivity({ activityId: entry.activityId });
      console.log(TAG, `END SUCCESS entity=${entityId}`);
      addOpsEntry({ timestamp: Date.now(), action: 'end', entityId, success: true, activityId: entry.activityId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLAError('END', entityId, e);
      addOpsEntry({ timestamp: Date.now(), action: 'end', entityId, success: false, error: msg });
    }
  }

  /** End all active activities (e.g. on logout) */
  async endAll(): Promise<void> {
    console.log(TAG, `END ALL — ${this.active.size} activities`);
    const ids = Array.from(this.active.keys());
    await Promise.all(ids.map((id) => this.end(id)));
    this.clearPersistedMap();
    this.tokenSaved.clear();
  }

  /** Force re-hydration (e.g. on app resume). Skips if hydration is currently running. */
  resetHydration(): void {
    if (this.hydrating) {
      console.log(TAG, 'RESET HYDRATION SKIPPED — hydration in progress');
      return;
    }
    this.hydrationPromise = null;
    this.tokenSaved.clear();
  }

  /** Check if a Live Activity is currently tracking the given entity */
  isTracking(entityId: string): boolean {
    return this.active.has(entityId);
  }

  // ── Token Cleanup ────────────────────────────────────────

  private async deleteTokenFromBackend(entityId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('live_activity_tokens')
        .delete()
        .eq('order_id', entityId);
      if (error) {
        console.warn(TAG, `Failed to delete LA token for ${entityId}: ${error.message}`);
      } else {
        console.log(TAG, `Deleted LA token for ${entityId}`);
      }
    } catch (e) {
      console.warn(TAG, 'Token cleanup exception:', e);
    }
  }

  // ── internal ──────────────────────────────────────────────

  private throttledUpdate(entry: ActiveEntry, data: LiveActivityData): void {
    const elapsed = Date.now() - entry.lastUpdate;

    if (elapsed >= THROTTLE_MS) {
      this.doUpdate(entry, data);
      return;
    }

    if (entry.pendingTimer) clearTimeout(entry.pendingTimer);
    entry.pendingTimer = setTimeout(() => {
      this.doUpdate(entry, data);
    }, THROTTLE_MS - elapsed);
  }

  private async doUpdate(entry: ActiveEntry, data: LiveActivityData): Promise<void> {
    // Bug 8: Guard against stale timer firing after end() already removed the entry
    if (!this.active.has(data.entity_id)) {
      console.log(TAG, `SKIP doUpdate — entity ${data.entity_id} no longer active (ended during throttle)`);
      return;
    }
    entry.lastUpdate = Date.now();
    entry.pendingTimer = null;
    entry.lastStatus = data.workflow_status;
    try {
      console.log(TAG, `UPDATE EXEC entity=${data.entity_id} status=${data.workflow_status}`);
      await LiveActivity.updateLiveActivity(data);
      console.log(TAG, `UPDATE SUCCESS entity=${data.entity_id}`);
      addOpsEntry({ timestamp: Date.now(), action: 'update', entityId: data.entity_id, status: data.workflow_status, success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLAError('UPDATE', data.entity_id, e);
      addOpsEntry({ timestamp: Date.now(), action: 'update', entityId: data.entity_id, status: data.workflow_status, success: false, error: msg });
    }
  }
}

export const LiveActivityManager = new _LiveActivityManager();
