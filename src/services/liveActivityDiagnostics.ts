// @ts-nocheck
/**
 * Live Activity Diagnostics
 * 
 * Runtime checks & error surfacing for debugging Live Activity issues
 * on-device without Xcode console access.
 */
import { Capacitor } from '@capacitor/core';
import { LiveActivity } from '@/plugins/live-activity';
import { getString, setString } from '@/lib/persistent-kv';

const TAG = '[LA-Diag]';
const DIAG_KEY = 'live_activity_diagnostics';

export interface DiagnosticResult {
  timestamp: string;
  isNative: boolean;
  platform: string;
  checks: {
    pluginAvailable: boolean;
    getActivitiesWorks: boolean;
    activeCount: number;
    startTestResult: 'success' | 'failed' | 'skipped';
    startTestError?: string;
  };
  errors: string[];
}

/** Last known errors from LiveActivityManager operations */
const recentErrors: Array<{ ts: number; op: string; entityId: string; error: string }> = [];

export function recordLAError(op: string, entityId: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(TAG, `${op} entity=${entityId}: ${msg}`);
  recentErrors.push({ ts: Date.now(), op, entityId, error: msg });
  // Keep last 20
  if (recentErrors.length > 20) recentErrors.shift();
  // Persist for inspection
  try {
    setString(DIAG_KEY + '_errors', JSON.stringify(recentErrors));
  } catch { /* best-effort */ }
}

export function getRecentLAErrors() {
  return [...recentErrors];
}

/** Run full diagnostics — safe to call anytime */
export async function runLiveActivityDiagnostics(dryRun = true): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
    checks: {
      pluginAvailable: false,
      getActivitiesWorks: false,
      activeCount: 0,
      startTestResult: 'skipped',
    },
    errors: [],
  };

  if (!result.isNative) {
    result.errors.push('Not running on a native platform');
    persistDiagnostics(result);
    return result;
  }

  // Check plugin availability
  try {
    const res = await LiveActivity.getActiveActivities();
    result.checks.pluginAvailable = true;
    result.checks.getActivitiesWorks = true;
    result.checks.activeCount = res.activities.length;
    console.log(TAG, `getActiveActivities OK — ${res.activities.length} active`, res.activities);
  } catch (e: any) {
    result.checks.pluginAvailable = false;
    result.errors.push(`getActiveActivities failed: ${e?.message ?? e}`);
  }

  // Optional: test start/end cycle
  if (!dryRun && result.checks.pluginAvailable) {
    try {
      const testData = {
        entity_type: 'diagnostic',
        entity_id: 'diag-test-' + Date.now(),
        workflow_status: 'preparing',
        eta_minutes: 5,
        driver_distance: null,
        driver_name: null,
        vehicle_type: null,
        progress_stage: 'preparing',
        progress_percent: 0.4,
        seller_name: null,
        item_count: null,
        order_short_id: '#TEST',
        seller_logo_url: null,
      };
      const { activityId } = await LiveActivity.startLiveActivity(testData);
      result.checks.startTestResult = 'success';
      console.log(TAG, `Test start OK — activityId=${activityId}`);
      // End immediately
      await LiveActivity.endLiveActivity({ activityId });
    } catch (e: any) {
      result.checks.startTestResult = 'failed';
      result.checks.startTestError = e?.message ?? String(e);
      result.errors.push(`startLiveActivity test failed: ${result.checks.startTestError}`);
    }
  }

  // Load persisted errors
  try {
    const raw = getString(DIAG_KEY + '_errors');
    if (raw) {
      const stored = JSON.parse(raw);
      if (Array.isArray(stored) && stored.length > 0) {
        result.errors.push(`${stored.length} recent operation error(s) in log`);
      }
    }
  } catch { /* ignore */ }

  persistDiagnostics(result);
  console.log(TAG, 'Diagnostics complete:', JSON.stringify(result, null, 2));
  return result;
}

function persistDiagnostics(result: DiagnosticResult) {
  try {
    setString(DIAG_KEY, JSON.stringify(result));
  } catch { /* best-effort */ }
}

export function getLastDiagnostics(): DiagnosticResult | null {
  try {
    const raw = getString(DIAG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
