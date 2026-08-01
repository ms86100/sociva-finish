// @ts-nocheck
import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { LiveActivity } from '@/plugins/live-activity';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { LiveActivityManager, getOperationLog, type OperationLogEntry } from '@/services/LiveActivityManager';
import { runLiveActivityDiagnostics, getRecentLAErrors, getLastDiagnostics, type DiagnosticResult } from '@/services/liveActivityDiagnostics';
import { syncActiveOrders } from '@/services/liveActivitySync';
import { useAuth } from '@/contexts/AuthContext';
import { getString } from '@/lib/persistent-kv';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Square,
  Trash2,
  Smartphone,
  Zap,
  ScrollText,
} from 'lucide-react';

interface NativeActivity {
  activityId: string;
  entityId: string;
}

export default function LiveActivityDebugPage() {
  const { user } = useAuth();
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(getLastDiagnostics);
  const [nativeActivities, setNativeActivities] = useState<NativeActivity[]>([]);
  const [opLog, setOpLog] = useState<OperationLogEntry[]>(getOperationLog);
  const [errors, setErrors] = useState(getRecentLAErrors);
  const [persistedMap, setPersistedMap] = useState<string>('');
  const [syncCount, setSyncCount] = useState<number | null>(null);
  const [loading, setLoading] = useState('');

  const refresh = useCallback(() => {
    setOpLog(getOperationLog());
    setErrors(getRecentLAErrors());
    try {
      setPersistedMap(getString('live_activity_map') ?? '(empty)');
    } catch { setPersistedMap('(read error)'); }
  }, []);

  const runDiag = async (dryRun: boolean) => {
    setLoading(dryRun ? 'diag' : 'test');
    try {
      const r = await runLiveActivityDiagnostics(dryRun);
      setDiagnostics(r);
      refresh();
    } finally { setLoading(''); }
  };

  const fetchNative = async () => {
    setLoading('native');
    try {
      const { activities } = await LiveActivity.getActiveActivities();
      setNativeActivities(activities as NativeActivity[]);
    } catch { setNativeActivities([]); }
    refresh();
    setLoading('');
  };

  const handleSync = async () => {
    if (!user) return;
    setLoading('sync');
    const count = await syncActiveOrders(user.id);
    setSyncCount(count);
    refresh();
    setLoading('');
  };

  const handleEndAll = async () => {
    setLoading('endall');
    await LiveActivityManager.endAll();
    refresh();
    await fetchNative();
    setLoading('');
  };

  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  return (
    <AppLayout headerTitle="Live Activity Debug" showBack>
      <div className="p-4 space-y-4 pb-20">

        {/* Device & Capability */}
        <Section title="Device & Capability" icon={<Smartphone size={16} />}>
          <Row label="Platform" value={platform} />
          <Row label="Native" value={isNative ? '✅ Yes' : '❌ No (web)'} />
          {diagnostics && (
            <>
              <Row label="Plugin Available" value={diagnostics.checks.pluginAvailable ? '✅' : '❌'} />
              <Row label="getActivities Works" value={diagnostics.checks.getActivitiesWorks ? '✅' : '❌'} />
              <Row label="Active Count" value={String(diagnostics.checks.activeCount)} />
              <Row label="Start Test" value={diagnostics.checks.startTestResult} />
              {diagnostics.checks.startTestError && (
                <p className="text-[11px] text-destructive mt-1 break-all">{diagnostics.checks.startTestError}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Last run: {diagnostics.timestamp}</p>
            </>
          )}
        </Section>

        {/* Test Actions */}
        <Section title="Test Actions" icon={<Zap size={16} />}>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => runDiag(true)} disabled={!!loading}>
              <RefreshCw size={14} className={loading === 'diag' ? 'animate-spin mr-1' : 'mr-1'} />
              Run Diagnostics
            </Button>
            <Button size="sm" variant="outline" onClick={() => runDiag(false)} disabled={!!loading}>
              <Play size={14} className="mr-1" />
              Start Test Activity
            </Button>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={!!loading}>
              <RefreshCw size={14} className={loading === 'sync' ? 'animate-spin mr-1' : 'mr-1'} />
              Sync Orders
            </Button>
            <Button size="sm" variant="outline" onClick={fetchNative} disabled={!!loading}>
              <Activity size={14} className="mr-1" />
              Fetch Native
            </Button>
            <Button size="sm" variant="destructive" onClick={handleEndAll} disabled={!!loading} className="col-span-2">
              <Trash2 size={14} className="mr-1" />
              End All Activities
            </Button>
          </div>
          {syncCount !== null && (
            <p className="text-xs text-muted-foreground mt-2">Last sync: {syncCount} active order(s)</p>
          )}
        </Section>

        {/* Native Activities */}
        <Section title={`Native Activities (${nativeActivities.length})`} icon={<Activity size={16} />}>
          {nativeActivities.length === 0 ? (
            <p className="text-xs text-muted-foreground">None — tap "Fetch Native" above</p>
          ) : nativeActivities.map((a) => (
            <div key={a.activityId} className="text-[11px] bg-muted/50 rounded p-2 mb-1">
              <span className="font-mono break-all">entity: {a.entityId}</span>
              <br />
              <span className="font-mono text-muted-foreground break-all">id: {a.activityId}</span>
            </div>
          ))}
        </Section>

        {/* Persisted Map */}
        <Section title="Persisted Map" icon={<ScrollText size={16} />}>
          <Button size="sm" variant="ghost" onClick={refresh} className="mb-2">
            <RefreshCw size={12} className="mr-1" /> Refresh
          </Button>
          <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
            {persistedMap || '(tap refresh)'}
          </pre>
        </Section>

        {/* Operation Log */}
        <Section title={`Operation Log (${opLog.length})`} icon={<ScrollText size={16} />}>
          {opLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">No operations recorded yet</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {[...opLog].reverse().map((entry, i) => (
                <div key={i} className={`text-[11px] rounded p-2 ${entry.success ? 'bg-accent/10' : 'bg-destructive/10'}`}>
                  <div className="flex items-center gap-1">
                    {entry.success ? <CheckCircle2 size={12} className="text-accent shrink-0" /> : <XCircle size={12} className="text-destructive shrink-0" />}
                    <span className="font-semibold uppercase">{entry.action}</span>
                    <span className="text-muted-foreground ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="font-mono break-all mt-0.5">{entry.entityId}</p>
                  {entry.status && <p className="text-muted-foreground">status: {entry.status}</p>}
                  {entry.activityId && <p className="text-muted-foreground">activityId: {entry.activityId}</p>}
                  {entry.error && <p className="text-destructive break-all">{entry.error}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Recent Errors */}
        <Section title={`Recent Errors (${errors.length})`} icon={<AlertTriangle size={16} />}>
          {errors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No errors</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...errors].reverse().map((e, i) => (
                <div key={i} className="text-[11px] bg-destructive/10 rounded p-2">
                  <span className="font-semibold">{e.op}</span>
                  <span className="text-muted-foreground ml-2">{new Date(e.ts).toLocaleTimeString()}</span>
                  <p className="font-mono break-all">{e.entityId}</p>
                  <p className="text-destructive break-all">{e.error}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </AppLayout>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
