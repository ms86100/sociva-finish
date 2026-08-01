// @ts-nocheck
import { useState, useContext } from 'react';
import { IdentityContext } from '@/contexts/auth/contexts';
import { runPushDiagnostics, printDiagnostics, DiagnosticResult } from '@/lib/pushDiagnostics';
import { supabase } from '@/integrations/supabase/client';
import { usePushNotifications } from '@/contexts/PushNotificationContext';
import { PUSH_BUILD_ID } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Trash2, Bell, Save, Settings, Zap } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { flushPushLogs } from '@/lib/pushLogger';
import { Capacitor } from '@capacitor/core';

interface LogRow {
  id: string;
  level: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function PushDebugPage() {
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const { requestFullPermission, registerPushNotifications, token, permissionStatus } = usePushNotifications();
  const [results, setResults] = useState<DiagnosticResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [apnsToken, setApnsToken] = useState<string | null>(null);
  const [apnsResult, setApnsResult] = useState<Record<string, unknown> | null>(null);
  const [apnsTesting, setApnsTesting] = useState(false);
  const [useSandbox, setUseSandbox] = useState(false);

  const handleRequestPermission = async () => {
    try {
      await requestFullPermission();
      toast.success('Permission requested — check status above');
    } catch (e) {
      toast.error('Permission request failed: ' + String(e));
    }
  };

  const handleOpenSettings = async () => {
    const platform = Capacitor.getPlatform();
    try {
      if (platform === 'ios') {
        // 'app-settings:' is Apple's documented URL scheme to open the app's own Settings page.
        // We use the Capacitor bridge to ensure it opens outside the WebView.
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: 'app-settings:' });
        return;
      }
      // Android: native-settings plugin (needs cap sync)
      const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
      await NativeSettings.open({ optionIOS: IOSSettings.App, optionAndroid: AndroidSettings.AppNotification });
    } catch (e) {
      // Fallback: instruct user manually
      toast.error('Go to Settings → Sociva → Notifications to enable.');
    }
  };

  const handleRegister = async () => {
    try {
      await registerPushNotifications();
      toast.success('Registration triggered');
    } catch (e) {
      toast.error('Registration failed: ' + String(e));
    }
  };

  const handleExtractApnsToken = async () => {
    try {
      const platform = Capacitor.getPlatform();
      if (platform !== 'ios') {
        toast.error('APNs tokens are iOS-only');
        return;
      }
      const { PushNotifications } = await import('@capacitor/push-notifications');
      // The registration event on iOS returns the raw APNs token (64-char hex)
      await PushNotifications.addListener('registration', (regToken) => {
        const raw = regToken.value;
        setApnsToken(raw);
        toast.success(`APNs token captured: ${raw.substring(0, 16)}…`);
      });
      await PushNotifications.register();
    } catch (e) {
      toast.error('Failed to extract APNs token: ' + String(e));
    }
  };

  const handleDirectApnsTest = async () => {
    if (!apnsToken) {
      toast.error('Extract the APNs token first');
      return;
    }
    setApnsTesting(true);
    setApnsResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('test-apns-direct', {
        body: {
          apns_token: apnsToken,
          title: 'Direct APNs Test',
          body: 'Bypassing Firebase — testing APNs directly 🚀',
          use_sandbox: useSandbox,
        },
      });
      if (error) throw error;
      setApnsResult(data);
      toast.success(`APNs response: ${data?.status}`);
    } catch (e) {
      toast.error('APNs test failed: ' + String(e));
      setApnsResult({ error: String(e) });
    } finally {
      setApnsTesting(false);
    }
  };

  const handleSaveTokenManually = async () => {
    if (!user) return toast.error('Not logged in');
    setSavingToken(true);
    try {
      // Try to get FCM token directly
      let fcmToken: string | null = null;
      const platform = Capacitor.getPlatform();
      
      if (platform === 'ios') {
        const { FCM } = await import('@capacitor-community/fcm');
        const result = await FCM.getToken();
        fcmToken = result.token;
      } else if (platform === 'android') {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        // On Android, register triggers the token event — but let's try to get existing
        await PushNotifications.register();
        toast.info('Android register triggered — token will be saved by the hook');
        setSavingToken(false);
        return;
      }

      if (!fcmToken) {
        toast.error('Could not retrieve FCM token');
        setSavingToken(false);
        return;
      }

      await supabase
        .from('device_tokens')
        .delete()
        .eq('token', fcmToken)
        .neq('user_id', user.id);

      const { error } = await supabase.from('device_tokens').upsert(
        { user_id: user.id, token: fcmToken, platform, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,token' }
      );
      if (error) throw error;
      toast.success(`Token saved! (${fcmToken.substring(0, 20)}…)`);
    } catch (e) {
      toast.error('Save failed: ' + String(e));
    } finally {
      setSavingToken(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      const r = await runPushDiagnostics(user?.id);
      printDiagnostics(r);
      setResults(r);
    } catch (e) {
      toast.error('Diagnostics failed: ' + String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleLoadLogs = async () => {
    if (!user) return;
    setLoadingLogs(true);
    // Flush any buffered logs first
    await flushPushLogs();
    try {
      const { data, error } = await supabase
        .from('push_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setLogs((data as LogRow[]) ?? []);
    } catch (e) {
      toast.error('Failed to load logs: ' + String(e));
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleClearLogs = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('push_logs')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
      setLogs([]);
      toast.success('Logs cleared');
    } catch (e) {
      toast.error('Failed to clear: ' + String(e));
    }
  };

  const levelColor = (level: string) => {
    if (level === 'error') return 'destructive';
    if (level === 'warn') return 'outline';
    return 'secondary';
  };

  return (
    <div className="min-h-screen bg-background p-4 pb-24 space-y-4">
      <h1 className="text-xl font-bold">🔔 Push Notification Debug</h1>
      <p className="text-sm text-muted-foreground">
        <strong>BUILD_ID: {PUSH_BUILD_ID}</strong>
        <br />
        User: {user?.id?.substring(0, 8) ?? 'not logged in'}…
        <br />
        Hook token: {token ? `${token.substring(0, 20)}…` : 'null'} | Permission: {permissionStatus}
        <br />
        href: {window.location.href}
        <br />
        lastModified: {document.lastModified}
      </p>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={handleRequestPermission} variant="outline" className="w-full">
            <Bell className="mr-2" size={16} /> Request Permission
          </Button>
          <Button onClick={handleOpenSettings} variant="outline" className="w-full">
            <Settings className="mr-2" size={16} /> Open App Settings (enable notifications)
          </Button>
          <Button onClick={handleRegister} variant="outline" className="w-full">
            <RefreshCw className="mr-2" size={16} /> Trigger Registration
          </Button>
          <Button onClick={handleSaveTokenManually} disabled={savingToken} variant="outline" className="w-full">
            {savingToken ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
            Save FCM Token to DB Manually
          </Button>
        </CardContent>
      </Card>

      {/* Direct APNs Test */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🍎 Direct APNs Test (Bypass Firebase)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This sends a push notification directly to Apple's APNs servers using your .p8 key — Firebase is completely bypassed.
          </p>

          <Button onClick={handleExtractApnsToken} variant="outline" className="w-full">
            <Zap className="mr-2" size={16} /> Extract Raw APNs Token
          </Button>

          {apnsToken && (
            <div className="bg-muted p-2 rounded text-xs font-mono break-all">
              <strong>APNs Token:</strong> {apnsToken}
            </div>
          )}

          {!apnsToken && (
            <div className="text-xs text-muted-foreground">
              <p>You can also paste a token manually:</p>
              <input
                type="text"
                placeholder="64-char hex APNs device token"
                className="w-full mt-1 p-2 border rounded text-xs font-mono bg-background"
                onChange={(e) => setApnsToken(e.target.value || null)}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={useSandbox}
                onChange={(e) => setUseSandbox(e.target.checked)}
              />
              Use Sandbox (for Xcode debug builds)
            </label>
          </div>

          <Button
            onClick={handleDirectApnsTest}
            disabled={apnsTesting || !apnsToken}
            className="w-full"
            variant="default"
          >
            {apnsTesting ? <Loader2 className="animate-spin mr-2" size={16} /> : <Zap className="mr-2" size={16} />}
            Send Direct APNs Push
          </Button>

          {apnsResult && (
            <div className="bg-muted p-3 rounded space-y-2">
              <div className="flex items-center gap-2">
                {(apnsResult as any).status === 200 ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <XCircle size={16} className="text-red-500" />
                )}
                <span className="font-bold text-sm">Status: {(apnsResult as any).status ?? 'error'}</span>
              </div>
              {(apnsResult as any).interpretation && (
                <p className="text-xs">{(apnsResult as any).interpretation}</p>
              )}
              <pre className="text-[10px] text-muted-foreground overflow-x-auto">
                {JSON.stringify(apnsResult, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diagnostics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleRun} disabled={running} className="w-full">
            {running ? <Loader2 className="animate-spin mr-2" size={16} /> : <RefreshCw className="mr-2" size={16} />}
            Run Diagnostics
          </Button>

          {results && (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  {r.ok ? (
                    <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <span className="font-medium">{r.step}</span>
                    <p className="text-muted-foreground text-xs break-all">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remote Logs */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Remote Logs</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleClearLogs}>
                <Trash2 size={14} className="mr-1" /> Clear
              </Button>
              <Button variant="outline" size="sm" onClick={handleLoadLogs} disabled={loadingLogs}>
                {loadingLogs ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No logs yet. Logs will appear here after the app runs push registration on your device.
            </p>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="border rounded-lg p-2 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={levelColor(log.level) as any} className="text-[10px]">
                        {log.level}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="font-mono break-all">{log.message}</p>
                    {log.metadata && (
                      <pre className="text-[10px] text-muted-foreground bg-muted p-1 rounded overflow-x-auto">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
