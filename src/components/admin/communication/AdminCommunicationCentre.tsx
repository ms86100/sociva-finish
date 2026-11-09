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
    let detail = '';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string; code?: string };
        detail = payload.error || payload.code || '';
      } catch {
        // ignore body parse errors
      }
    }
    const payload = (data || {}) as { error?: string; code?: string };
    throw new Error(payload.error || detail || error.message);
  }
  if (data && data.success === false && data.error) {
    throw new Error(String(data.error));
  }
  return data as Record<string, unknown>;
}

function Gate({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-2.5 border-b border-border/30 last:border-0">
      <span className="text-foreground/80">{label}</span>
      <Badge
        variant={ok ? 'default' : 'secondary'}
        className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-muted text-muted-foreground'}
      >
        {ok ? 'Pass' : 'Pending'}
      </Badge>
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
      // Load config first so a failing stats/history call cannot blank the whole page.
      const cfgRes = await invokeAdmin({ action: 'get_config' });
      setConfig((cfgRes.config as ProviderConfig) || null);
      setInstance((cfgRes.instance as InstanceRow) || null);
      setEvolutionConfigured(!!cfgRes.evolutionConfigured);

      const settled = await Promise.allSettled([
        invokeAdmin({ action: 'stats' }),
        invokeAdmin({ action: 'messages' }),
        invokeAdmin({ action: 'audit' }),
      ]);
      if (settled[0].status === 'fulfilled') {
        setStats((settled[0].value.stats as typeof stats) || []);
      }
      if (settled[1].status === 'fulfilled') {
        setMessages((settled[1].value.messages as MsgRow[]) || []);
      }
      if (settled[2].status === 'fulfilled') {
        setAudit((settled[2].value.audit as Array<Record<string, unknown>>) || []);
      }
    } catch (e) {
      adminNotify.error(e);
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
      adminNotify.error(e);
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
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-16">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Communication Centre
      </div>
    );
  }

  const activeProvider = config?.active_provider || 'meta';
  const readinessPassed = [
    config?.readiness_connected,
    config?.readiness_health_ok,
    config?.readiness_session_valid,
    config?.readiness_test_message_ok,
    config?.readiness_webhook_ok,
    config?.readiness_admin_approved,
  ].filter(Boolean).length;

  return (
    <div className="relative max-w-4xl space-y-6 pb-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 h-40 rounded-[1.75rem] bg-gradient-to-br from-emerald-500/12 via-teal-400/6 to-transparent"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] border border-border/50 bg-background/80 px-5 py-5 shadow-sm backdrop-blur-sm sm:px-6">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Sociva ops</p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Communication Centre</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            One WhatsApp provider at a time for seller alerts. Meta is the safe default. Push stays untouched.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-2 border-border/70 shrink-0"
          onClick={() => void refresh()}
          disabled={!!busy}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' || loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="relative overflow-hidden rounded-[1.5rem] border-border/50 shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400" />
        <CardHeader className="space-y-1 px-5 pt-6 pb-4 sm:px-6">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-600" /> Active provider
          </CardTitle>
          <CardDescription className="text-sm">
            Live route: <span className="font-semibold text-foreground">{activeProvider}</span>
            {activeProvider === 'evolution_go' && (
              <> · mode <span className="font-semibold text-foreground">{config?.evolution_mode}</span></>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Button
              className={`h-11 rounded-xl justify-center ${
                activeProvider === 'meta' ? 'shadow-sm' : 'border-border/70'
              }`}
              variant={activeProvider === 'meta' ? 'default' : 'outline'}
              disabled={!!busy}
              onClick={() => {
                setPendingProvider('meta');
                setSwitchOpen(true);
              }}
            >
              Meta Cloud API
            </Button>
            <Button
              className={`h-11 rounded-xl justify-center ${
                activeProvider === 'evolution_go' ? 'shadow-sm' : 'border-border/70'
              }`}
              variant={activeProvider === 'evolution_go' ? 'default' : 'outline'}
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
              className="h-11 rounded-xl gap-2 sm:min-w-[11rem]"
              variant="destructive"
              disabled={!!busy || activeProvider === 'meta'}
              onClick={() => setKillOpen(true)}
            >
              <ShieldAlert className="h-4 w-4" /> Kill switch
            </Button>
          </div>
          {!evolutionConfigured && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              Evolution Go Edge secrets are not configured yet (`EVOLUTION_GO_BASE_URL`, `EVOLUTION_GO_API_KEY`, webhook secret).
              Meta remains available.
            </div>
          )}
          {config?.last_kill_switch_at && (
            <p className="text-xs text-muted-foreground">
              Last kill switch: {new Date(config.last_kill_switch_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="evolution" className="w-full space-y-4">
        <TabsList className="h-auto w-full flex flex-wrap justify-start gap-1 rounded-2xl border border-border/50 bg-muted/40 p-1.5">
          <TabsTrigger value="evolution" className="rounded-xl px-3.5 py-2 data-[state=active]:shadow-sm">
            Evolution Go
          </TabsTrigger>
          <TabsTrigger value="ops" className="rounded-xl px-3.5 py-2 data-[state=active]:shadow-sm">
            Ops dashboard
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-xl px-3.5 py-2 data-[state=active]:shadow-sm">
            Message history
          </TabsTrigger>
          <TabsTrigger value="audit" className="rounded-xl px-3.5 py-2 data-[state=active]:shadow-sm">
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evolution" className="mt-0 space-y-5 focus-visible:outline-none">
          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="space-y-3 px-5 pt-6 pb-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">Connection</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    Pair once, then verify. Scan QR in WhatsApp Linked devices.
                  </CardDescription>
                </div>
                {statusBadge()}
              </div>
              <div className="grid gap-2 rounded-xl border border-border/40 bg-muted/25 px-3.5 py-3 text-xs text-muted-foreground sm:grid-cols-2">
                <p>
                  Last connected:{' '}
                  <span className="font-medium text-foreground/80">
                    {instance?.last_connected_at ? new Date(instance.last_connected_at).toLocaleString() : 'Never'}
                  </span>
                </p>
                <p>
                  Last health:{' '}
                  <span className="font-medium text-foreground/80">
                    {instance?.last_health_at ? new Date(instance.last_health_at).toLocaleString() : 'Never'}
                    {instance?.last_health_ok === false ? ' (failed)' : instance?.last_health_ok ? ' (ok)' : ''}
                  </span>
                </p>
                {instance?.connected_phone_masked && (
                  <p className="sm:col-span-2">
                    Linked phone: <span className="font-medium text-foreground/80">{instance.connected_phone_masked}</span>
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5 px-5 pb-6 sm:px-6">
              {instance?.last_error && (
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-xs text-destructive">
                  {instance.last_error}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Primary</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    className="h-11 rounded-xl gap-2"
                    disabled={!!busy || !evolutionConfigured}
                    onClick={() =>
                      void run('connect', async () => {
                        const res = await invokeAdmin({ action: 'connect', reason: reason || 'admin_connect' });
                        const qr = (res.qrBase64 as string) || null;
                        setQrBase64(qr);
                        if (qr) {
                          adminNotify.success('Scan this QR in WhatsApp - Linked devices');
                        } else {
                          throw new Error(
                            String(
                              res.error ||
                                res.note ||
                                'Connect ran but Evolution did not return a QR yet. Tap Refresh QR in a few seconds.',
                            ),
                          );
                        }
                      })
                    }
                  >
                    {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                    Connect WhatsApp
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl gap-2 border-border/70"
                    disabled={!!busy || !evolutionConfigured}
                    onClick={() =>
                      void run('qr', async () => {
                        const res = await invokeAdmin({ action: 'qr', reason: reason || 'admin_refresh_qr' });
                        const qr = (res.qrBase64 as string) || null;
                        setQrBase64(qr);
                        if (!qr) {
                          throw new Error(
                            String(
                              res.error ||
                                'No QR yet. Tap Connect WhatsApp to reset the session, then Refresh QR again.',
                            ),
                          );
                        }
                        adminNotify.success('QR refreshed - scan with WhatsApp Linked devices');
                      })
                    }
                  >
                    <QrCode className="h-4 w-4" /> Refresh QR
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Checks</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 border-border/70"
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
                    className="rounded-xl gap-2 border-border/70"
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
                    className="rounded-xl gap-2 ml-auto"
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
              </div>

              {qrBase64 && (
                <div className="rounded-[1.25rem] border border-emerald-500/25 bg-gradient-to-b from-emerald-500/8 to-muted/20 px-4 py-5 sm:px-6">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <p className="text-center text-sm font-medium text-foreground">Scan to link WhatsApp</p>
                    <p className="text-center text-xs leading-relaxed text-muted-foreground">
                      WhatsApp → Linked devices → Link a device. Then tap Verify status.
                    </p>
                    <div className="rounded-2xl border border-border/40 bg-white p-3 shadow-sm">
                      <img
                        src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                        alt="WhatsApp QR code for Sociva Evolution Go pairing"
                        className="h-56 w-56 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="space-y-2 px-5 pt-6 pb-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Readiness for live Evolution Go</CardTitle>
                <Badge variant="outline" className="rounded-lg border-border/60 tabular-nums">
                  {readinessPassed}/6
                </Badge>
              </div>
              <CardDescription className="text-sm leading-relaxed">
                Live needs connection, health, session, a real test message, webhook proof, and admin approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
              <div className="rounded-xl border border-border/40 px-3.5">
                <Gate ok={config?.readiness_connected} label="Connected session" />
                <Gate ok={config?.readiness_health_ok} label="API health check" />
                <Gate ok={config?.readiness_session_valid} label="Valid QR session" />
                <Gate ok={config?.readiness_test_message_ok} label="Test message capability" />
                <Gate ok={config?.readiness_webhook_ok} label="Webhook receipt verified" />
                <Gate ok={config?.readiness_admin_approved} label="Admin approval for live" />
              </div>
              <Button
                className="h-11 w-full rounded-xl sm:w-auto"
                disabled={
                  !!busy ||
                  !(
                    config?.readiness_connected &&
                    config?.readiness_health_ok &&
                    config?.readiness_session_valid &&
                    config?.readiness_test_message_ok &&
                    config?.readiness_webhook_ok
                  )
                }
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

          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="space-y-1 px-5 pt-6 pb-4 sm:px-6">
              <CardTitle className="text-base">Test WhatsApp message</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Sends through Evolution Go. Confirm delivery on the handset before calling it a pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-6 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="evo-phone">Phone (country code, digits only)</Label>
                <Input
                  id="evo-phone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="h-11 rounded-xl border-border/70"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="evo-msg">Message</Label>
                <Textarea
                  id="evo-msg"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="min-h-[96px] rounded-xl border-border/70"
                />
              </div>
              <Button
                className="h-11 rounded-xl gap-2"
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ops" className="mt-0 space-y-3 focus-visible:outline-none">
          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="space-y-1 px-5 pt-6 pb-4 sm:px-6">
              <CardTitle className="text-base">Last 24h message statuses</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                `provider_accepted` means HTTP accept only - not WhatsApp delivery.
                Delivered/read appear only when webhooks confirm them.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-6 sm:px-6">
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

        <TabsContent value="history" className="mt-0 focus-visible:outline-none">
          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="px-5 pt-6 pb-4 sm:px-6">
              <CardTitle className="text-base">Recent messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto px-5 pb-6 sm:px-6">
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

        <TabsContent value="audit" className="mt-0 focus-visible:outline-none">
          <Card className="rounded-[1.5rem] border-border/50 shadow-sm">
            <CardHeader className="space-y-1 px-5 pt-6 pb-4 sm:px-6">
              <CardTitle className="text-base">Provider audit</CardTitle>
              <CardDescription className="text-sm">
                Includes kill switch, provider changes, and explicit cross-provider retries.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto px-5 pb-6 sm:px-6">
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
