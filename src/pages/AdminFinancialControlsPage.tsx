import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Check,
  Clock,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  CONFIG_OPTIONS,
  FLAG_GROUP_ORDER,
  type FinancialControlChangeRequest,
  type FinancialControlType,
  type FinancialFeatureFlagRow,
  formatControlValue,
  flagGroup,
  flagRisk,
  pendingRequestFor,
  rejectionReason,
  riskBadgeClass,
} from '@/lib/financial-controls';
import {
  useFinancialControlMutations,
  useFinancialControlsRealtime,
  useFinancialControlsSnapshot,
} from '@/hooks/useFinancialControls';
import { PayoutEnablementChecklist } from '@/components/admin/PayoutEnablementChecklist';
import { FinancialAdjustmentsPanel } from '@/components/admin/FinancialAdjustmentsPanel';
import { ConfirmAction } from '@/components/ui/confirm-action';

const PREFLIGHT_LABELS: Record<string, string> = {
  schema_ready: 'Schema',
  payment_ready: 'Payments rail',
  payout_ready: 'Payout rail',
  refund_ready: 'Refund rail',
  reconciliation_ready: 'Reconciliation',
  money_movement_disabled: 'Money movement gated',
  controls_present: 'Control tables',
};

function RequestReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  loading,
  requireReason = true,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
  requireReason?: boolean;
}) {
  const [reason, setReason] = useState('');
  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (requireReason && trimmed.length < 10) {
      toast.error('Reason must be at least 10 characters');
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                requireReason
                  ? 'Explain why this change is needed (min 10 characters)'
                  : 'Optional rejection note'
              }
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving…' : confirmLabel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'approved'
      ? 'default'
      : status === 'pending'
        ? 'secondary'
        : status === 'rejected'
          ? 'destructive'
          : 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

function RequestRow({
  request,
  currentUserId,
  onApprove,
  onReject,
  onCancel,
  busy,
  approveConfirm,
}: {
  request: FinancialControlChangeRequest;
  currentUserId?: string;
  onApprove: (request: FinancialControlChangeRequest) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  busy: boolean;
  approveConfirm?: boolean;
}) {
  const isMaker = currentUserId === request.requested_by;
  const canApprove = request.status === 'pending' && !isMaker;
  const canCancel = request.status === 'pending' && isMaker;
  const rejected = rejectionReason(request.metadata);
  const expired =
    request.status === 'pending' &&
    request.expires_at &&
    new Date(request.expires_at).getTime() <= Date.now();

  const approveButton = (
    <Button size="sm" onClick={() => onApprove(request)} disabled={busy || expired}>
      <Check size={14} className="mr-1" />
      Approve
    </Button>
  );

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{request.control_key}</p>
            <p className="text-[11px] text-muted-foreground">
              {request.control_type.replace('_', ' ')} · {request.requester_name || request.requested_by.slice(0, 8)}
            </p>
          </div>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-xs">
          {formatControlValue(request.control_type, request.old_value)}
          {' → '}
          <span className="font-medium">{formatControlValue(request.control_type, request.new_value)}</span>
        </p>
        <p className="text-xs text-muted-foreground">{request.reason}</p>
        {rejected && (
          <p className="text-[11px] text-destructive">Rejected: {rejected}</p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Requested {format(new Date(request.requested_at), 'MMM d, yyyy HH:mm')}
          {request.decided_at && ` · decided ${format(new Date(request.decided_at), 'MMM d, yyyy HH:mm')}`}
          {request.expires_at && ` · expires ${format(new Date(request.expires_at), 'MMM d, yyyy HH:mm')}`}
        </p>
        {request.status === 'pending' && (
          <div className="flex flex-wrap gap-2 pt-1">
            {canApprove && (
              <>
                {approveConfirm ? (
                  <ConfirmAction
                    title="Approve critical financial change?"
                    description={`This will immediately apply ${request.control_key} → ${formatControlValue(request.control_type, request.new_value)}. Confirm you have reviewed the reason and preflight.`}
                    actionLabel="Approve and apply"
                    variant="default"
                    onConfirm={() => onApprove(request)}
                  >
                    {approveButton}
                  </ConfirmAction>
                ) : (
                  approveButton
                )}
                <Button size="sm" variant="outline" onClick={() => onReject(request.id)} disabled={busy}>
                  <X size={14} className="mr-1" />
                  Reject
                </Button>
              </>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" onClick={() => onCancel(request.id)} disabled={busy}>
                Cancel request
              </Button>
            )}
            {isMaker && (
              <Badge variant="outline" className="text-[10px]">
                Awaiting different admin
              </Badge>
            )}
            {expired && (
              <Badge variant="destructive" className="text-[10px]">
                Expired
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FlagControlRow({
  flag,
  pending,
  onRequestToggle,
  disabled,
}: {
  flag: FinancialFeatureFlagRow;
  pending?: FinancialControlChangeRequest;
  onRequestToggle: (flag: FinancialFeatureFlagRow, enabled: boolean) => void;
  disabled: boolean;
}) {
  const risk = flagRisk(flag.key);
  const blocked = Boolean(pending) || disabled;

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{flag.key}</p>
          <Badge variant="outline" className={`text-[10px] ${riskBadgeClass(risk)}`}>
            {risk}
          </Badge>
          {pending && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Clock size={10} />
              Pending
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{flag.description}</p>
        {flag.updated_at && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Updated {format(new Date(flag.updated_at), 'MMM d, yyyy')}
          </p>
        )}
      </div>
      <Switch
        checked={flag.enabled}
        disabled={blocked}
        onCheckedChange={(checked) => onRequestToggle(flag, checked)}
        aria-label={`Toggle ${flag.key}`}
      />
    </div>
  );
}

export default function AdminFinancialControlsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const snapshot = useFinancialControlsSnapshot();
  const mutations = useFinancialControlMutations();
  useFinancialControlsRealtime();
  const [activeTab, setActiveTab] = useState('overview');
  const [dialog, setDialog] = useState<{
    mode: 'request' | 'reject';
    controlType: FinancialControlType;
    controlKey: string;
    newValue: string;
    requestId?: string;
    label: string;
  } | null>(null);

  const flagsByGroup = useMemo(() => {
    const groups = new Map<string, FinancialFeatureFlagRow[]>();
    for (const group of FLAG_GROUP_ORDER) groups.set(group, []);
    for (const flag of snapshot.data?.feature_flags || []) {
      const group = flagGroup(flag.key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(flag);
    }
    return groups;
  }, [snapshot.data?.feature_flags]);

  const payoutReady = useMemo(() => {
    const flags = snapshot.data?.feature_flags || [];
    const configs = snapshot.data?.configurations || [];
    const sellerPayout = flags.find((f) => f.key === 'seller_payout_enabled')?.enabled;
    const route = flags.find((f) => f.key === 'razorpay_route_order_transfer_enabled')?.enabled;
    const mode = configs.find((c) => c.key === 'provider_payout_mode')?.value;
    return { sellerPayout, route, mode };
  }, [snapshot.data]);

  const adminCount = snapshot.data?.platform_admin_count ?? 0;
  const pending = snapshot.data?.pending_requests || [];
  const pendingAdjustments = snapshot.data?.pending_adjustments || [];
  const recentAdjustments = snapshot.data?.recent_adjustments || [];
  const pendingTotal =
    snapshot.data?.pending_total_count ?? pending.length + pendingAdjustments.length;

  const openStepRequest = (
    controlType: FinancialControlType,
    key: string,
    value: string,
  ) => {
    if (controlType === 'feature_flag') {
      setDialog({
        mode: 'request',
        controlType,
        controlKey: key,
        newValue: value,
        label: `Enable ${key}`,
      });
      return;
    }
    openConfigRequest(key, value);
  };

  const openConfigRequest = (key: string, value: string) => {
    setDialog({
      mode: 'request',
      controlType: 'configuration',
      controlKey: key,
      newValue: value,
      label: `Set ${key}`,
    });
  };

  const runMutation = async (reason: string) => {
    if (!dialog) return;
    try {
      if (dialog.mode === 'request') {
        await mutations.requestChange.mutateAsync({
          controlType: dialog.controlType,
          controlKey: dialog.controlKey,
          newValue: dialog.newValue,
          reason,
        });
        toast.success('Change requested — a different admin must approve');
      } else if (dialog.requestId) {
        await mutations.rejectChange.mutateAsync({ requestId: dialog.requestId, reason });
        toast.success('Request rejected');
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleApprove = async (request: FinancialControlChangeRequest) => {
    try {
      await mutations.approveChange.mutateAsync(request.id);
      toast.success('Change approved and applied');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const needsApproveConfirm = (request: FinancialControlChangeRequest) =>
    request.control_type === 'feature_flag' &&
    (flagRisk(request.control_key) === 'critical' || request.new_value === 'true');

  const handleCancel = async (requestId: string) => {
    try {
      await mutations.cancelChange.mutateAsync(requestId);
      toast.success('Request cancelled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const openFlagRequest = (flag: FinancialFeatureFlagRow, enabled: boolean) => {
    setDialog({
      mode: 'request',
      controlType: 'feature_flag',
      controlKey: flag.key,
      newValue: enabled ? 'true' : 'false',
      label: `${enabled ? 'Enable' : 'Disable'} ${flag.key}`,
    });
  };

  const preflight = snapshot.data?.preflight || {};

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">Financial controls</h1>
            <p className="text-xs text-muted-foreground">
              Maker-checker workflow — changes need a second admin to approve
            </p>
          </div>
          <Button
            size="icon"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin-financial-controls-snapshot'] });
              void snapshot.refetch();
            }}
            disabled={snapshot.isFetching}
          >
            <RefreshCw size={16} className={snapshot.isFetching ? 'animate-spin' : ''} />
          </Button>
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 flex gap-2">
          <ShieldAlert size={18} className="text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Direct edits to financial flags are blocked at the database layer. Request a change here;
            another admin approves before it takes effect. For offline UTR payouts use{' '}
            <Link to="/admin/seller-payouts" className="text-primary underline">
              Seller payouts
            </Link>
            ; for order-level evidence use{' '}
            <Link to="/admin/financial-trace" className="text-primary underline">
              Financial trace
            </Link>
            .
          </p>
        </div>

        {adminCount < 2 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Only {adminCount} platform admin account is configured. Maker-checker requires at least two admins —
            add another admin before requesting financial changes.
          </div>
        )}

        {snapshot.isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {snapshot.error instanceof Error ? snapshot.error.message : 'Failed to load controls'}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="flags">Feature flags</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="pending" className="gap-1.5">
              Pending
              {pendingTotal > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {pendingTotal}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="adjustments" className="gap-1.5">
              Adjustments
              {pendingAdjustments.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {pendingAdjustments.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Runtime readiness</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(PREFLIGHT_LABELS).map(([key, label]) => {
                  const value = preflight[key];
                  const on = value === true;
                  const off = value === false;
                  return (
                    <div
                      key={key}
                      className={`rounded-lg border p-2 text-xs ${
                        on ? 'border-emerald-500/30 bg-emerald-500/10' : off ? 'border-muted' : 'border-border'
                      }`}
                    >
                      <p className="font-medium">{label}</p>
                      <p className="text-muted-foreground">
                        {on ? 'Ready' : off ? 'Not ready' : '—'}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {snapshot.data && (
              <PayoutEnablementChecklist
                snapshot={snapshot.data}
                onRequestStep={openStepRequest}
                busy={mutations.busy || adminCount < 2}
              />
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Current payout flags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">seller_payout_enabled</span>
                  <Badge variant={payoutReady.sellerPayout ? 'default' : 'outline'}>
                    {payoutReady.sellerPayout ? 'ON' : 'OFF'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">provider_payout_mode</span>
                  <span className="text-xs font-medium">{payoutReady.mode || 'disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">razorpay_route_order_transfer_enabled</span>
                  <Badge variant={payoutReady.route ? 'default' : 'outline'}>
                    {payoutReady.route ? 'ON' : 'OFF'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {pending.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Awaiting approval ({pending.length})</h3>
                <div className="space-y-2">
                  {pending.slice(0, 3).map((req) => (
                    <RequestRow
                      key={req.id}
                      request={req}
                      currentUserId={user?.id}
                      onApprove={handleApprove}
                      approveConfirm={needsApproveConfirm(req)}
                      onReject={(id) =>
                        setDialog({
                          mode: 'reject',
                          controlType: req.control_type,
                          controlKey: req.control_key,
                          newValue: req.new_value,
                          requestId: id,
                          label: 'Reject change',
                        })
                      }
                      onCancel={handleCancel}
                      busy={mutations.busy}
                    />
                  ))}
                </div>
                {pending.length > 3 && (
                  <Button variant="link" className="px-0 mt-2" onClick={() => setActiveTab('pending')}>
                    View all pending
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="flags" className="space-y-6 mt-4">
            {FLAG_GROUP_ORDER.map((groupName) => {
              const flags = flagsByGroup.get(groupName) || [];
              if (flags.length === 0) return null;
              return (
                <div key={groupName}>
                  <h3 className="text-sm font-semibold mb-2">{groupName}</h3>
                  <div className="space-y-2">
                    {flags.map((flag) => (
                      <FlagControlRow
                        key={flag.key}
                        flag={flag}
                        pending={pendingRequestFor(pending, 'feature_flag', flag.key)}
                        onRequestToggle={openFlagRequest}
                        disabled={mutations.busy || adminCount < 2}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="config" className="space-y-4 mt-4">
            {(snapshot.data?.configurations || []).map((cfg) => {
              const options = CONFIG_OPTIONS[cfg.key];
              const pendingCfg = pendingRequestFor(pending, 'configuration', cfg.key);
              return (
                <Card key={cfg.key}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm">{cfg.key}</p>
                      {pendingCfg && (
                        <Badge variant="secondary" className="text-[10px]">
                          Pending → {formatControlValue('configuration', pendingCfg.new_value)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{cfg.description}</p>
                    <p className="text-sm">
                      Current:{' '}
                      <span className="font-medium">
                        {formatControlValue('configuration', cfg.value)}
                      </span>
                    </p>
                    {options ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Select
                          disabled={Boolean(pendingCfg) || mutations.busy}
                          onValueChange={(value) => {
                            if (value !== cfg.value) openConfigRequest(cfg.key, value);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Request new value" />
                          </SelectTrigger>
                          <SelectContent>
                            {options.values.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} disabled={opt.value === cfg.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          id={`cfg-${cfg.key}`}
                          defaultValue={cfg.value}
                          disabled={Boolean(pendingCfg) || mutations.busy}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const target = e.currentTarget;
                            const next = target.value.trim();
                            if (next && next !== cfg.value) openConfigRequest(cfg.key, next);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={Boolean(pendingCfg) || mutations.busy}
                          onClick={() => {
                            const el = document.getElementById(`cfg-${cfg.key}`) as HTMLInputElement | null;
                            const next = el?.value.trim();
                            if (next && next !== cfg.value) openConfigRequest(cfg.key, next);
                          }}
                        >
                          Request change
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="pending" className="space-y-2 mt-4">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No pending requests</p>
            ) : (
              pending.map((req) => (
                <RequestRow
                  key={req.id}
                  request={req}
                  currentUserId={user?.id}
                  onApprove={handleApprove}
                  approveConfirm={needsApproveConfirm(req)}
                  onReject={(id) =>
                    setDialog({
                      mode: 'reject',
                      controlType: req.control_type,
                      controlKey: req.control_key,
                      newValue: req.new_value,
                      requestId: id,
                      label: 'Reject change',
                    })
                  }
                  onCancel={handleCancel}
                  busy={mutations.busy}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="adjustments" className="mt-4">
            <FinancialAdjustmentsPanel
              pending={pendingAdjustments}
              recent={recentAdjustments}
              currentUserId={user?.id}
              onSubmitted={() => {
                void snapshot.refetch();
              }}
            />
          </TabsContent>

          <TabsContent value="history" className="space-y-2 mt-4">
            {(snapshot.data?.recent_requests || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No recent decisions</p>
            ) : (
              (snapshot.data?.recent_requests || []).map((req) => (
                <RequestRow
                  key={req.id}
                  request={req}
                  currentUserId={user?.id}
                  onApprove={handleApprove}
                  onReject={() => {}}
                  onCancel={() => {}}
                  busy={mutations.busy}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <RequestReasonDialog
        open={Boolean(dialog)}
        title={dialog?.label || ''}
        description={
          dialog?.mode === 'request'
            ? `Requesting ${formatControlValue(dialog.controlType, dialog.newValue)} for ${dialog.controlKey}. Another admin must approve.`
            : 'Optionally add a rejection note for the audit log.'
        }
        confirmLabel={dialog?.mode === 'request' ? 'Submit request' : 'Reject'}
        requireReason={dialog?.mode === 'request'}
        loading={mutations.busy}
        onClose={() => setDialog(null)}
        onConfirm={runMutation}
      />
    </AppLayout>
  );
}
