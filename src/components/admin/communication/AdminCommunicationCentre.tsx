import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Unplug,
  Plug,
  Send,
  Activity,
} from 'lucide-react';
import { adminNotify } from '@/lib/admin-notify';

type ProviderConfig = {
  active_provider: 'meta' | 'evolution_go';
  evolution_mode: 'disabled' | 'dry_run' | 'live';
  readiness_connected?: boolean;
  readiness_health_ok?: boolean;
  readiness_session_valid?: boolean;
  readiness_test_message_ok?: boolean;
  readiness_webhook_ok?: boolean;
  readiness_admin_approved?: boolean;
  last_kill_switch_at?: string | null;
  dry_run_completed_at?: string | null;
};

type InstanceRow = {
  connection_status?: string;
  last_connected_at?: string | null;
  last_health_at?: string | null;
  last_health_ok?: boolean | null;
  last_error?: string | null;
  connected_phone_masked?: string | null;
  webhook_configured_at?: string | null;
};

type MsgRow = {
  id: string;
  direction: string;
  phone: string;
  message: string | null;
  provider: string;
  status: string;
  dry_run: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  delivery_status_supported?: boolean;
};

async function invokeAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('evolution-go-admin', { body });
  if (error) {
    const payload = (data || {}) as { error?: string; code?: string };
    throw new Error(payload.error || error.message);
  }
  return data as Record<string, unknown>;
}

function Gate({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={ok ? 'default' : 'secondary'}>{ok ? 'Pass' : 'Pending'}</Badge>
    </div>
  );
}

export function AdminCommunicationCentre() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [instance, setInstance] = useState<InstanceRow | null>(null);
  const [evolutionConfigured, setEvolutionConfigured] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [stats, setStats] = useState<Array<{ provider: string; status: string; dry_run: boolean; cnt: number }>>([]);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [testPhone, setTestPhone] = useState('91');
  const [testMessage, setTestMessage] = useState('Sociva Evolution Go operational test');
  const [killOpen, setKillOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<'meta' | 'evolution_go'>('meta');
  const [pendingMode, setPendingMode] = useState<'dry_run' | 'live'>('dry_run');
  const [reason, setReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, statsRes, msgRes, auditRes] = await Promise.all([
        invokeAdmin({ action: 'get_config' }),
        invokeAdmin({ action: 'stats' }),
        invokeAdmin({ action: 'messages' }),
        invokeAdmin({ action: 'audit' }),
      ]);
      setConfig((cfgRes.config as ProviderConfig) || null);
      setInstance((cfgRes.instance as InstanceRow) || null);
      setEvolutionConfigured(!!cfgRes.evolutionConfigured);
      setStats((statsRes.stats as typeof stats) || []);
      setMessages((msgRes.messages as MsgRow[]) || []);
      setAudit((auditRes.audit as Array<Record<string, unknown>>) || []);
    } catch (e) {
      adminNotify.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const readinessComplete = useMemo(() => {
    if (!config) return false;
    return !!(
      config.readiness_connected &&
      config.readiness_health_ok &&
      config.readiness_session_valid &&
      config.readiness_test_message_ok &&
      config.readiness_webhook_ok &&
      config.readiness_admin_approved
    );
  }, [config]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
      adminNotify.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const statusBadge = () => {
    const s = instance?.connection_status || 'unknown';
    const variant = s === 'connected' ? 'default' : s === 'qr' ? 'secondary' : 'destructive';
    return <Badge variant={variant as 'default' | 'secondary' | 'destructive'}>{s}</Badge>;
  };

  if (loading && !config) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Communication Centre…
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Communication Centre</h2>
          <p className="text-sm text-muted-foreground mt-1">
            WhatsApp providers for seller notifications. Meta Cloud API is the production default.
            Only one provider is active. Push notifications are unaffected.
          </p>
        </div>
        <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => void refresh()} disabled={!!busy}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Card className="rounded-2xl border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Active provider
          </CardTitle>
          <CardDescription>
            Current: <strong>{config?.active_provider || 'meta'}</strong>
            {config?.active_provider === 'evolution_go' && (
              <> · mode <strong>{config.evolution_mode}</strong></>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-xl"
              variant={config?.active_provider === 'meta' ? 'default' : 'outline'}
              disabled={!!busy}
              onClick={() => {
                setPendingProvider('meta');
                setSwitchOpen(true);
              }}
            >
              Meta Cloud API
            </Button>
            <Button
              className="rounded-xl"
              variant={config?.active_provider === 'evolution_go' ? 'default' : 'outline'}
              disabled={!!busy || !evolutionConfigured}
              onClick={() => {
                setPendingProvider('evolution_go');
                setPendingMode(readinessComplete ? 'live' : 'dry_run');
                setSwitchOpen(true);
              }}
            >
              Evolution Go
            </Button>
            <Button
              className="rounded-xl gap-2"
              variant="destructive"
              disabled={!!busy || config?.active_provider === 'meta'}
              onClick={() => setKillOpen(true)}
            >
              <ShieldAlert className="h-4 w-4" /> Kill switch to Meta
            </Button>
          </div>
          {!evolutionConfigured && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Evolution Go Edge secrets are not configured yet (`EVOLUTION_GO_BASE_URL`, `EVOLUTION_GO_API_KEY`, webhook secret).
              Meta remains available.
            </p>
          )}
          {config?.last_kill_switch_at && (
            <p className="text-xs text-muted-foreground">
              Last kill switch: {new Date(config.last_kill_switch_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="evolution" className="w-full">
        <TabsList className="rounded-xl">
          <TabsTrigger value="evolution" className="rounded-lg">Evolution Go</TabsTrigger>
          <TabsTrigger value="ops" className="rounded-lg">Ops dashboard</TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg">Message history</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-lg">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="evolution" className="space-y-4 pt-3">
          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Connection</CardTitle>
                {statusBadge()}
              </div>
              <CardDescription>
                Last connected: {instance?.last_connected_at ? new Date(instance.last_connected_at).toLocaleString() : 'Never'}
                {' · '}
                Last health: {instance?.last_health_at ? new Date(instance.last_health_at).toLocaleString() : 'Never'}
                {instance?.last_health_ok === false ? ' (failed)' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {instance?.last_error && (
                <p className="text-xs text-destructive">{instance.last_error}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-xl gap-2"
                  disabled={!!busy}
                  onClick={() =>
                    void run('connect', async () => {
                      const res = await invokeAdmin({ action: 'connect', reason });
                      setQrBase64((res.qrBase64 as string) || null);
                      adminNotify.success('Connect started - scan QR if shown');
                    })
                  }
                >
                  {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                  Connect WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl gap-2"
                  disabled={!!busy}
                  onClick={() =>
                    void run('qr', async () => {
                      const res = await invokeAdmin({ action: 'qr' });
                      setQrBase64((res.qrBase64 as string) || null);
                      if (!res.qrBase64) adminNotify.error('No QR returned - connect first or session already linked');
                    })
                  }
                >
                  <QrCode className="h-4 w-4" /> Refresh QR
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl gap-2"
                  disabled={!!busy}
                  onClick={() =>
                    void run('status', async () => {
                      const res = await invokeAdmin({ action: 'status' });
                      adminNotify.success(res.connected ? 'Connected verified' : 'Not connected');
                    })
                  }
                >
                  <Activity className="h-4 w-4" /> Verify status
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl gap-2"
                  disabled={!!busy}
                  onClick={() =>
                    void run('health', async () => {
                      await invokeAdmin({ action: 'health' });
                      adminNotify.success('Health checked');
                    })
                  }
                >
                  Health check
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl gap-2"
                  disabled={!!busy}
                  onClick={() =>
                    void run('disconnect', async () => {
                      await invokeAdmin({ action: 'disconnect', reason: reason || 'admin_disconnect' });
                      setQrBase64(null);
                      adminNotify.success('Disconnected');
                    })
                  }
                >
                  <Unplug className="h-4 w-4" /> Disconnect
                </Button>
              </div>

              {qrBase64 && (
                <div className="rounded-xl border border-border/50 bg-muted/30 p-4 flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground text-center">
                    Scan with WhatsApp → Linked Devices. Connection is not confirmed until Verify status succeeds.
                  </p>
                  <img
                    src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                    alt="WhatsApp QR code for Sociva Evolution Go pairing"
                    className="w-56 h-56 bg-white rounded-lg"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Readiness for live Evolution Go</CardTitle>
              <CardDescription>
                Live activation requires connection, health, session, real test message, webhook proof, and admin approval.
                A DB-only dry-run log is not enough.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Gate ok={config?.readiness_connected} label="Connected session" />
              <Gate ok={config?.readiness_health_ok} label="API health check" />
              <Gate ok={config?.readiness_session_valid} label="Valid QR session" />
              <Gate ok={config?.readiness_test_message_ok} label="Test message capability" />
              <Gate ok={config?.readiness_webhook_ok} label="Webhook receipt verified" />
              <Gate ok={config?.readiness_admin_approved} label="Admin approval for live" />
              <Button
                className="rounded-xl mt-2"
                disabled={!!busy || !(
                  config?.readiness_connected &&
                  config?.readiness_health_ok &&
                  config?.readiness_session_valid &&
                  config?.readiness_test_message_ok &&
                  config?.readiness_webhook_ok
                )}
                onClick={() =>
                  void run('approve', async () => {
                    await invokeAdmin({ action: 'approve_live', reason: reason || 'approve_live' });
                    adminNotify.success('Live Evolution approved - you may switch provider to live');
                  })
                }
              >
                Approve live Evolution Go
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Test WhatsApp message</CardTitle>
              <CardDescription>
                Sends through Evolution Go for operational proof. Confirm delivery on the handset before claiming a real-device pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="evo-phone">Phone (country code, digits only)</Label>
                <Input id="evo-phone" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="evo-msg">Message</Label>
                <Textarea id="evo-msg" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} className="rounded-xl" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-xl gap-2"
                  disabled={!!busy || !testPhone.trim()}
                  onClick={() =>
                    void run('test', async () => {
                      const res = await invokeAdmin({
                        action: 'test_message',
                        phoneNumber: testPhone,
                        message: testMessage,
                      });
                      if (res.success) {
                        adminNotify.success(
                          res.note
                            ? String(res.note)
                            : `Accepted (${res.elapsedMs ?? '?'}ms) - confirm on device`,
                        );
                      } else {
                        adminNotify.error(String(res.error || res.code || 'Test failed'));
                      }
                    })
                  }
                >
                  {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send real test
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ops" className="pt-3 space-y-3">
          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Last 24h message statuses</CardTitle>
              <CardDescription>
                `provider_accepted` means HTTP accept only - not WhatsApp delivery.
                Delivered/read appear only when webhooks confirm them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No WhatsApp message rows in the last 24 hours.</p>
              ) : (
                <div className="space-y-2">
                  {stats.map((row, i) => (
                    <div key={`${row.provider}-${row.status}-${row.dry_run}-${i}`} className="flex items-center justify-between text-sm border-b border-border/40 py-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{row.provider}</Badge>
                        <span>{row.status}</span>
                        {row.dry_run && <Badge variant="secondary">dry-run</Badge>}
                      </div>
                      <span className="font-semibold tabular-nums">{row.cnt}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="pt-3">
          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages logged yet.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="rounded-xl border border-border/40 p-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{m.provider}</Badge>
                      <Badge variant={m.status === 'failed' ? 'destructive' : 'secondary'}>{m.status}</Badge>
                      <span className="text-xs text-muted-foreground">{m.direction}</span>
                      {m.dry_run && <Badge variant="secondary">dry-run</Badge>}
                      {m.delivery_status_supported === false && (
                        <Badge variant="outline">status unsupported</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{m.phone} · {new Date(m.created_at).toLocaleString()}</p>
                    {m.message && <p className="text-xs whitespace-pre-wrap break-words">{m.message}</p>}
                    {m.error_message && <p className="text-xs text-destructive">{m.error_code}: {m.error_message}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="pt-3">
          <Card className="rounded-2xl border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Provider audit</CardTitle>
              <CardDescription>Includes kill switch, provider changes, and explicit cross-provider retries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit rows yet.</p>
              ) : (
                audit.map((row) => (
                  <div key={String(row.id)} className="rounded-xl border border-border/40 p-3 text-xs space-y-1">
                    <div className="flex flex-wrap gap-2 items-center">
                      <Badge>{String(row.action)}</Badge>
                      <span className="text-muted-foreground">{row.created_at ? new Date(String(row.created_at)).toLocaleString() : ''}</span>
                    </div>
                    <p>
                      {String(row.previous_provider || '-')} → {String(row.new_provider || '-')}
                      {row.reason ? ` · ${String(row.reason)}` : ''}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={killOpen} onOpenChange={setKillOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Kill switch to Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              Immediately sets the active WhatsApp provider to Meta Cloud API without redeploying.
              In-flight attempts keep their stamped provider. Failed messages are not silently rerouted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl"
              onClick={() =>
                void run('kill', async () => {
                  await invokeAdmin({ action: 'kill_switch_meta', reason: reason || 'kill_switch' });
                  adminNotify.success('Active provider is Meta');
                  setKillOpen(false);
                })
              }
            >
              Switch to Meta now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Change WhatsApp provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Only one provider sends seller WhatsApp notifications. Pending attempts already claimed keep their stamped provider.
              Failed messages are not auto-rerouted; use an audited explicit retry if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Provider</Label>
              <p className="text-sm font-medium">{pendingProvider}</p>
            </div>
            {pendingProvider === 'evolution_go' && (
              <div className="space-y-2">
                <Label>Evolution mode</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={pendingMode === 'dry_run' ? 'default' : 'outline'}
                    className="rounded-xl"
                    onClick={() => setPendingMode('dry_run')}
                  >
                    dry_run
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={pendingMode === 'live' ? 'default' : 'outline'}
                    className="rounded-xl"
                    disabled={!readinessComplete}
                    onClick={() => setPendingMode('live')}
                  >
                    live
                  </Button>
                </div>
                {!readinessComplete && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Live requires all readiness gates including admin approval.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="switch-reason">Reason (audited)</Label>
              <Input id="switch-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl" />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl"
              onClick={() =>
                void run('switch', async () => {
                  await invokeAdmin({
                    action: 'set_provider',
                    provider: pendingProvider,
                    mode: pendingProvider === 'evolution_go' ? pendingMode : undefined,
                    reason: reason || 'admin_switch',
                  });
                  adminNotify.success(`Active provider: ${pendingProvider}`);
                  setSwitchOpen(false);
                })
              }
            >
              Confirm switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
