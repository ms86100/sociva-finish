import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminStoreSearchPicker } from '@/components/admin/AdminStoreSearchPicker';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { BILLING_EVENT_LABELS, type BillingEventType } from '@/lib/sellerCredits';
import type { AdminStoreCreditRow } from '@/lib/adminStoreCredits';
import { buildSellerCreditsGoLiveChecks, goLiveChecksAllowSpend, type GoLiveCertCase, type SellerCreditsGoLiveEvidence } from '@/lib/sellerCreditsGoLive';
import { toast } from 'sonner';
import { format } from 'date-fns';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

type BillingRule = {
  event_type: BillingEventType;
  enabled: boolean;
  amount: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

const EVENT_EXPLAIN: Record<string, string> = {
  ORDER_COMPLETED: 'Seller pays when a product/cart order is completed. Credits are reserved when the order is created, then committed on completion or released on cancel.',
  ENQUIRY_CREATED: 'Seller pays immediately when a buyer enquiry is created.',
  SERVICE_BOOKING: 'Seller credits are reserved when a booking is confirmed, then committed after completion (or policy) or released on cancel/seller failure.',
  CONTACT_REQUEST: 'Seller pays on first call/message in the Admin-configured debounce window per buyer+product. Repeats inside the window are not charged.',
};

function PaginatedList<T>({
  items,
  pageSize = 12,
  renderItem,
  emptyLabel,
  itemLabel = 'items',
}: {
  items: T[];
  pageSize?: number;
  renderItem: (item: T, index: number) => ReactNode;
  emptyLabel: string;
  itemLabel?: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages - 1);
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">{slice.map((item, i) => renderItem(item, safePage * pageSize + i))}</div>
      {items.length > pageSize && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[11px] text-muted-foreground">
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, items.length)} of {items.length} {itemLabel}
          </p>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={14} />
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSellerCreditsPage() {
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('Price change');
  const [adjustSeller, setAdjustSeller] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { amount: string; enabled: boolean }>>({});
  const [graceMinutes, setGraceMinutes] = useState('');
  const [noShowPolicy, setNoShowPolicy] = useState('');
  const [unresolvedPolicy, setUnresolvedPolicy] = useState('');
  const [debounceHours, setDebounceHours] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [healthyMin, setHealthyMin] = useState('');
  const [lowMin, setLowMin] = useState('');
  const [criticalMin, setCriticalMin] = useState('');
  const [pkgLabel, setPkgLabel] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');
  const [pkgCredits, setPkgCredits] = useState('');
  const [pkgSort, setPkgSort] = useState('60');
  const [editingPkg, setEditingPkg] = useState<string | null>(null);
  const [reverseSeller, setReverseSeller] = useState('');
  const [reverseEvent, setReverseEvent] = useState('ORDER_COMPLETED');
  const [reverseRefType, setReverseRefType] = useState('order');
  const [reverseRefId, setReverseRefId] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [refundPurchase, setRefundPurchase] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [activeStoreId, setActiveStoreId] = useState('');
  const [certRunning, setCertRunning] = useState(false);
  const [goLiveEvidence, setGoLiveEvidence] = useState<SellerCreditsGoLiveEvidence | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const debouncedStoreSearch = useDebouncedValue(storeSearch, 300);
  const debouncedPurchaseSearch = useDebouncedValue(purchaseSearch, 300);

  const selectStoreFor = (target: 'adjust' | 'reverse' | 'browse', row: AdminStoreCreditRow) => {
    if (target === 'adjust') setAdjustSeller(row.seller_id);
    if (target === 'reverse') setReverseSeller(row.seller_id);
    setActiveStoreId(row.seller_id);
  };

  const flagsQuery = useQuery({
    queryKey: ['admin-seller-credit-flags'],
    queryFn: async () => {
      const { data } = await supabase.from('seller_billing_rules').select('*').order('event_type');
      const purchase = await adminRpc('seller_credit_flag_enabled', { p_key: 'seller_credit_purchase_enabled' });
      const spend = await adminRpc('seller_credit_flag_enabled', { p_key: 'seller_credit_spend_enabled' });
      const settings = await adminRpc('admin_list_seller_credit_settings');
      const audit = await adminRpc('admin_list_seller_billing_audit', { p_limit: 40 });
      const thresholds = await adminRpc('admin_list_seller_credit_thresholds');
      const packages = await adminRpc('admin_list_seller_credit_packages');
      const ready = await adminRpc('seller_credit_resolution_ready');
      const charges = await adminRpc('admin_list_reversible_seller_charges', { p_limit: 20 });
      const ledger = await adminRpc('admin_list_seller_credit_ledger', { p_limit: 40 });
      const timeline = await adminRpc('admin_list_seller_credit_financial_timeline', { p_limit: 60 });
      const rpcError = [purchase, spend, settings, ready].find((result) => result.error);
      if (rpcError?.error) throw new Error(rpcError.error.message);
      return {
        rules: (data || []) as BillingRule[],
        purchaseEnabled: Boolean(purchase.data),
        spendEnabled: Boolean(spend.data),
        settings: Array.isArray(settings.data) ? settings.data : [],
        audit: Array.isArray(audit.data) ? audit.data : [],
        thresholds: Array.isArray(thresholds.data) ? thresholds.data : [],
        packages: Array.isArray(packages.data) ? packages.data : [],
        charges: Array.isArray(charges.data) ? charges.data : [],
        ledger: Array.isArray(ledger.data) ? ledger.data : [],
        timeline: Array.isArray(timeline.data) ? timeline.data : [],
        resolutionReady: Boolean((ready.data as { ok?: boolean } | null)?.ok),
      };
    },
  });

  const sellersQuery = useQuery({
    queryKey: ['admin-seller-credits', debouncedStoreSearch],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_credits', { p_search: debouncedStoreSearch || null });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: debouncedStoreSearch.trim().length >= 1,
  });

  const purchasesQuery = useQuery({
    queryKey: ['admin-seller-credit-purchases', debouncedPurchaseSearch],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_credit_purchases', {
        p_search: debouncedPurchaseSearch || null,
        p_limit: 50,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  });

  const settingMap = useMemo(() => {
    const map: Record<string, { value?: string | null; updated_at?: string | null; updated_by?: string | null }> = {};
    for (const row of flagsQuery.data?.settings || []) {
      const item = row as { key: string; value?: string | null; updated_at?: string | null; updated_by?: string | null };
      map[item.key] = item;
    }
    return map;
  }, [flagsQuery.data?.settings]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-seller-credit-flags'] });
    queryClient.invalidateQueries({ queryKey: ['admin-seller-credits'] });
    queryClient.invalidateQueries({ queryKey: ['admin-seller-credit-purchases'] });
  };

  const parseCertCases = (payload: unknown): GoLiveCertCase[] => {
    if (!payload || typeof payload !== 'object') return [];
    const cases = (payload as { cases?: unknown }).cases;
    if (!Array.isArray(cases)) return [];
    return cases
      .filter((row): row is GoLiveCertCase => Boolean(row && typeof row === 'object' && 'id' in row && 'result' in row))
      .map((row) => ({ id: String((row as GoLiveCertCase).id), result: String((row as GoLiveCertCase).result) }));
  };

  const loadGoLiveEvidence = async (runCert = false) => {
    try {
      const verify = await adminRpc('admin_verify_seller_credit_production_purchase', { p_purchase_id: null });
      if (verify.error) throw verify.error;
      let isolated = goLiveEvidence?.isolatedCertOk != null && !runCert
        ? { ok: goLiveEvidence.isolatedCertOk, cases: goLiveEvidence.isolatedCases || [] }
        : null;
      if (runCert) {
        setCertRunning(true);
        const cert = await adminRpc('admin_run_seller_credit_monetization_certification');
        if (cert.error) throw cert.error;
        isolated = {
          ok: Boolean((cert.data as { ok?: boolean } | null)?.ok),
          cases: parseCertCases(cert.data),
        };
      }
      setGoLiveEvidence({
        productionVerifyOk: Boolean((verify.data as { ok?: boolean } | null)?.ok),
        productionCases: parseCertCases(verify.data),
        isolatedCertOk: isolated?.ok,
        isolatedCases: isolated?.cases,
      });
      if (runCert) {
        toast.success(isolated?.ok ? 'Billing certification passed (10/10).' : 'Billing certification finished with failures — see checklist.');
        refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load go-live evidence.');
    } finally {
      setCertRunning(false);
    }
  };

  useEffect(() => {
    void loadGoLiveEvidence(true);
  }, []);

  const thresholdValue = (key: string) => {
    const row = (flagsQuery.data?.thresholds || []).find((item: any) => item.key === key);
    return row?.value != null ? String(row.value) : '';
  };

  const saveThreshold = async (key: string, value: string, label: string) => {
    const amount = Number(value || thresholdValue(key));
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid threshold.');
      return;
    }
    const { error } = await adminRpc('admin_update_seller_credit_threshold', {
      p_key: key,
      p_value: amount,
      p_reason: reason || `${label} update`,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`${label} saved.`);
      refresh();
    }
  };

  const savePackage = async (isActive = true) => {
    const price = Number(pkgPrice);
    const credits = Number(pkgCredits);
    const sort = Number(pkgSort);
    if (!pkgLabel.trim() || !Number.isFinite(price) || price <= 0 || !Number.isFinite(credits) || credits <= 0) {
      toast.error('Package name, price, and credit amount are required.');
      return;
    }
    const { error } = await adminRpc('admin_upsert_seller_credit_package', {
      p_id: editingPkg,
      p_label: pkgLabel.trim(),
      p_amount: price,
      p_credits_amount: credits,
      p_is_active: isActive,
      p_sort_order: Number.isFinite(sort) ? sort : 100,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(isActive ? 'Package saved. Historical purchases keep the amount they bought.' : 'Package deactivated for new purchases.');
      setEditingPkg(null);
      setPkgLabel('');
      setPkgPrice('');
      setPkgCredits('');
      refresh();
    }
  };

  const togglePackage = async (pack: any, isActive: boolean) => {
    const { error } = await adminRpc('admin_upsert_seller_credit_package', {
      p_id: pack.id,
      p_label: pack.label,
      p_amount: Number(pack.amount),
      p_credits_amount: Number(pack.credits_amount ?? pack.amount),
      p_is_active: isActive,
      p_sort_order: Number(pack.sort_order ?? 100),
    });
    if (error) toast.error(error.message);
    else {
      toast.success(isActive ? 'Package activated.' : 'Package hidden from new purchases. Existing purchases are unchanged.');
      refresh();
    }
  };

  const setFlag = async (key: string, enabled: boolean, opts?: { spendReady?: boolean }) => {
    if (key === 'seller_credit_spend_enabled' && enabled) {
      if (!opts?.spendReady) {
        toast.error('Spend is blocked until the go-live checklist below is fully green.');
        return;
      }
      if (!window.confirm(
        'Turn Spend ON?\n\n'
        + 'Sellers will be charged Sociva Credits for orders, enquiries, bookings, and contacts. '
        + 'Buyer discovery already requires a positive credit balance.',
      )) {
        return;
      }
    }
    try {
      const { error } = await adminRpc('admin_set_seller_credit_flag', { p_key: key, p_enabled: enabled });
      if (error) toast.error(error.message);
      else {
        toast.success(
          key === 'seller_credit_purchase_enabled'
            ? (enabled ? 'Purchase enabled.' : 'Purchase disabled.')
            : (enabled ? 'Spend / gating enabled.' : 'Spend / gating disabled.'),
        );
        refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the flag.');
    }
  };

  const saveRule = async (eventType: string) => {
    const rule = (flagsQuery.data?.rules || []).find((r) => r.event_type === eventType);
    const draft = ruleDrafts[eventType];
    const amount = Number(draft?.amount ?? rule?.amount);
    const enabled = draft?.enabled ?? Boolean(rule?.enabled);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid amount for future events.');
      return;
    }
    if (!window.confirm(`Change ${BILLING_EVENT_LABELS[eventType as BillingEventType] || eventType} for future events only?`)) return;
    const { error } = await adminRpc('admin_update_seller_billing_rule', {
      p_event_type: eventType,
      p_amount: amount,
      p_enabled: enabled,
      p_reason: reason || 'Admin update',
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Billing rule updated for future events only. Existing reservations keep their snapshot.');
      refresh();
    }
  };

  const saveSetting = async (key: string, value: string, label: string) => {
    const { error } = await adminRpc('admin_update_seller_credit_setting', {
      p_key: key,
      p_value: value,
      p_reason: reason || `${label} update`,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`${label} saved. Existing reservations keep their snapshot.`);
      refresh();
    }
  };

  const adjust = async (direction: 'add' | 'remove') => {
    const raw = Number(adjustAmount);
    if (!adjustSeller || !Number.isFinite(raw) || raw === 0 || !adjustReason.trim()) {
      toast.error('Seller, non-zero amount, and reason are required.');
      return;
    }
    const amount = direction === 'remove' ? -Math.abs(raw) : Math.abs(raw);
    const { error, data } = await adminRpc('admin_adjust_seller_credits', {
      p_seller_id: adjustSeller,
      p_amount: amount,
      p_reason: adjustReason.trim(),
      p_request_id: crypto.randomUUID(),
    });
    if (error) toast.error(error.message);
    else {
      const result = data as { available?: number; idempotent?: boolean } | null;
      toast.success(result?.idempotent ? 'Duplicate adjustment ignored.' : `Adjustment recorded. Balance ${formatPrice(Number(result?.available) || 0)}.`);
      setAdjustAmount('');
      setAdjustReason('');
      refresh();
    }
  };

  const reverseCharge = async () => {
    if (!reverseSeller || !reverseRefId.trim() || !reverseReason.trim()) {
      toast.error('Seller, original reference, and reason are required.');
      return;
    }
    const { error, data } = await adminRpc('reverse_seller_credit_charge', {
      p_seller_id: reverseSeller,
      p_event_type: reverseEvent,
      p_reference_type: reverseRefType,
      p_reference_id: reverseRefId.trim(),
      p_reason: reverseReason.trim(),
    });
    if (error) toast.error(error.message);
    else {
      const result = data as { available?: number; idempotent?: boolean } | null;
      toast.success(result?.idempotent ? 'Already reversed.' : `Reversal recorded. Balance ${formatPrice(Number(result?.available) || 0)}.`);
      setReverseReason('');
      refresh();
    }
  };

  const refundCaptured = async () => {
    if (!refundPurchase.trim() || !refundReason.trim()) {
      toast.error('Purchase id and reason are required.');
      return;
    }
    const { error } = await adminRpc('refund_seller_credit_purchase', {
      p_purchase_id: refundPurchase.trim(),
      p_provider_refund_id: `admin:${crypto.randomUUID()}`,
      p_reason: refundReason.trim(),
      p_amount: null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Purchase refunded. Unused credits were removed from the seller balance.');
      setRefundPurchase('');
      setRefundReason('');
      refresh();
    }
  };

  const spendOn = !!flagsQuery.data?.spendEnabled;
  const purchaseOn = !!flagsQuery.data?.purchaseEnabled;

  const orderCompletedRule = useMemo(
    () => (flagsQuery.data?.rules || []).find((rule: BillingRule) => rule.event_type === 'ORDER_COMPLETED'),
    [flagsQuery.data?.rules],
  );

  const healthyMinDisplay = Number(thresholdValue('healthy_min')) || 100;
  const lowMinDisplay = Number(thresholdValue('low_min')) || 50;
  const discoveryActivationMin = useMemo(() => {
    if (!spendOn) return null;
    if (!orderCompletedRule?.enabled) return 0;
    const amount = Number(orderCompletedRule.amount);
    return Number.isFinite(amount) ? amount : 0;
  }, [spendOn, orderCompletedRule]);

  const midBalanceExample = Math.max(
    (discoveryActivationMin ?? 0) + 1,
    Math.min(30, healthyMinDisplay - 1),
  );

  const capturedPurchaseCount = useMemo(
    () => (purchasesQuery.data || []).filter((row: { status?: string }) => row.status === 'captured').length,
    [purchasesQuery.data],
  );

  const goLiveChecks = useMemo(
    () => buildSellerCreditsGoLiveChecks({
      purchaseEnabled: purchaseOn,
      spendEnabled: spendOn,
      resolutionReady: Boolean(flagsQuery.data?.resolutionReady),
      capturedPurchaseCount,
      purchaseLedgerCount: (flagsQuery.data?.ledger || []).filter(
        (row: { type?: string }) => row.type === 'purchase',
      ).length,
      evidence: goLiveEvidence ?? undefined,
    }),
    [purchaseOn, spendOn, flagsQuery.data, capturedPurchaseCount, goLiveEvidence],
  );

  const spendGoLiveReady = goLiveChecksAllowSpend(goLiveChecks);

  const selectedReverseCharge = useMemo(
    () => (flagsQuery.data?.charges || []).find(
      (row: { seller_id?: string; event_type?: string; reference_id?: string }) =>
        row.seller_id === reverseSeller
        && row.event_type === reverseEvent
        && row.reference_id === reverseRefId,
    ),
    [flagsQuery.data?.charges, reverseSeller, reverseEvent, reverseRefId],
  );

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Monetization · Seller Credits</h1>
            <p className="text-xs text-muted-foreground">Admin-controlled rates only. Historical charges stay snapshotted.</p>
          </div>
        </div>
      </SafeHeader>
      <div className="p-4 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="rates" className="text-xs sm:text-sm">Rates &amp; rules</TabsTrigger>
            <TabsTrigger value="packages" className="text-xs sm:text-sm">Packages</TabsTrigger>
            <TabsTrigger value="stores" className="text-xs sm:text-sm">Stores &amp; ops</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs sm:text-sm">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Feature flags</p>
            <p className="text-xs text-muted-foreground">
              Purchase lets sellers buy credits via Razorpay. Spend/gating charges those credits on orders, enquiries, bookings, and contacts.
              Spend is currently {spendOn ? 'ON' : 'OFF'} — marketplace selling is {spendOn ? 'credit-gated' : 'not blocked by credits'}.
            </p>
            {flagsQuery.isError && (
              <p className="text-xs text-destructive">
                Could not load live flags. Refresh this page. If this persists, the Admin session is missing RPC access.
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm">Purchase enabled</span>
              <Switch checked={purchaseOn} onCheckedChange={(v) => setFlag('seller_credit_purchase_enabled', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Spend / gating enabled</span>
              <Switch
                checked={spendOn}
                disabled={!spendOn && !spendGoLiveReady}
                onCheckedChange={(v) => {
                  if (v) {
                    void setFlag('seller_credit_spend_enabled', true, { spendReady: spendGoLiveReady });
                    return;
                  }
                  void setFlag('seller_credit_spend_enabled', false);
                }}
              />
            </div>
            {!spendOn && (
              <p className="text-xs text-amber-700">
                Spend is OFF. Sellers are not charged for platform usage events. Buyer discovery still requires a positive Sociva Credit balance (activation floor). Marketplace charging stays off until Spend is deliberately enabled after go-live sign-off.
              </p>
            )}
            {spendOn && (
              <p className="text-xs text-destructive font-medium">
                Spend is ON — sellers are credit-gated. Turn OFF unless you are running a controlled billing test.
              </p>
            )}
            {!flagsQuery.data?.resolutionReady && (
              <p className="text-xs text-destructive">
                Spend cannot turn on until booking grace minutes are set. Buyer no-show is locked to commit unless you change it.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Spend go-live checklist</p>
            <p className="text-xs text-muted-foreground">
              Spend remains blocked in Admin until every item below is green. Purchase can stay ON while Spend is OFF.
              Live purchase verification runs automatically; billing certification uses isolated CREDIT-VERIFY stores only.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={certRunning} onClick={() => void loadGoLiveEvidence(true)}>
                {certRunning ? 'Running billing certification…' : 'Run billing certification'}
              </Button>
              <Button size="sm" variant="ghost" disabled={certRunning} onClick={() => void loadGoLiveEvidence(false)}>
                Refresh live purchase proof
              </Button>
            </div>
            <ul className="text-[11px] space-y-1.5">
              {goLiveChecks.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span className={
                    item.status === 'pass' ? 'text-green-700'
                      : item.status === 'fail' ? 'text-destructive'
                        : item.status === 'blocked' ? 'text-muted-foreground'
                          : 'text-amber-700'
                  }>
                    {item.status === 'pass' ? '✓' : item.status === 'fail' ? '✗' : item.status === 'blocked' ? '—' : '?'}
                  </span>
                  <span>
                    {item.label}
                    {item.detail ? ` — ${item.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {!spendGoLiveReady && (
              <p className="text-xs text-amber-700">Spend enable is disabled until all checklist items pass.</p>
            )}
            {spendGoLiveReady && !spendOn && (
              <p className="text-xs text-green-700">Checklist is green — you can turn Spend / gating ON in Feature flags.</p>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="rates" className="space-y-4 mt-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Billing rates</p>
            <p className="text-xs text-muted-foreground">
              Who pays: the seller, in Sociva Credits (not the buyer, not seller earnings). When Spend is OFF, rates are stored for future use and nothing is charged — but stores still need credits to become discoverable.
              Changing a rate applies to future events only. Existing reservations keep their snapshot.
            </p>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Change reason" />
            {(flagsQuery.data?.rules || []).map((rule) => {
              const draft = ruleDrafts[rule.event_type] || {
                amount: String(rule.amount ?? ''),
                enabled: Boolean(rule.enabled),
              };
              return (
                <div key={rule.event_type} className="space-y-1 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium flex-1">{BILLING_EVENT_LABELS[rule.event_type] || rule.event_type}</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.amount}
                      className="w-28"
                      onChange={(e) => setRuleDrafts((prev) => ({
                        ...prev,
                        [rule.event_type]: { ...draft, amount: e.target.value },
                      }))}
                    />
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(enabled) => setRuleDrafts((prev) => ({
                        ...prev,
                        [rule.event_type]: { ...draft, enabled },
                      }))}
                    />
                    <Button size="sm" variant="outline" onClick={() => saveRule(rule.event_type)}>Save</Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{EVENT_EXPLAIN[rule.event_type]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Last updated {rule.updated_at ? format(new Date(rule.updated_at), 'MMM d, yyyy · h:mm a') : '—'}
                    {rule.updated_by ? ` · ${rule.updated_by}` : ''}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Booking billing resolution</p>
            <p className="text-xs text-muted-foreground">
              Confirmed bookings reserve credits. Completed / delivered commits the snapshot. Cancelled / rejected / failed / seller failure releases.
              After appointment + grace, unresolved bookings follow the unresolved policy. Buyer no-show follows the no-show policy. Disputes after commit use Admin reversal — not a second booking workflow.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="1"
                value={graceMinutes || settingMap.booking_resolution_grace_minutes?.value || ''}
                onChange={(e) => setGraceMinutes(e.target.value)}
                placeholder="Grace minutes"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveSetting(
                  'booking_resolution_grace_minutes',
                  graceMinutes || settingMap.booking_resolution_grace_minutes?.value || '',
                  'Grace period',
                )}
              >
                Save grace
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={noShowPolicy || settingMap.buyer_no_show_policy?.value || 'commit'}
                onChange={(e) => setNoShowPolicy(e.target.value)}
              >
                <option value="commit">Buyer no-show: commit reserved credits</option>
                <option value="release">Buyer no-show: release reservation</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveSetting(
                  'buyer_no_show_policy',
                  noShowPolicy || settingMap.buyer_no_show_policy?.value || 'commit',
                  'Buyer no-show policy',
                )}
              >
                Save policy
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={unresolvedPolicy || settingMap.unresolved_after_grace_policy?.value || 'commit'}
                onChange={(e) => setUnresolvedPolicy(e.target.value)}
              >
                <option value="commit">Unresolved after grace: commit reserved credits</option>
                <option value="release">Unresolved after grace: release reservation</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveSetting(
                  'unresolved_after_grace_policy',
                  unresolvedPolicy || settingMap.unresolved_after_grace_policy?.value || 'commit',
                  'Unresolved after grace',
                )}
              >
                Save unresolved
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                max="168"
                value={debounceHours || settingMap.contact_debounce_hours?.value || '24'}
                onChange={(e) => setDebounceHours(e.target.value)}
                placeholder="Contact debounce hours"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveSetting(
                  'contact_debounce_hours',
                  debounceHours || settingMap.contact_debounce_hours?.value || '24',
                  'Contact debounce hours',
                )}
              >
                Save debounce
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Contact debounce: first call/message in this window is charged; repeats are not. Runtime reads this setting (1–168 hours).
            </p>
            <p className="text-[11px] text-muted-foreground">
              V1 system-controlled (not Admin-configurable): seller cancellation / seller failure always releases reserved credits.
              Disputes after commit use Charge reversal below — not a second booking workflow.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Health thresholds</p>
            <p className="text-xs text-muted-foreground">
              These bands label the seller balance and can send low/exhausted notifications. They do not block transactions, do not affect purchasing, and do not hide products from buyers.
              Exhausted is always available ≤ 0. Critical is at or below Critical max, or below the Low/Critical boundary. Low is below Healthy min but at or above that boundary.
            </p>
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <p className="text-xs font-medium">Buyer visibility (Spend / gating)</p>
              {!spendOn ? (
                <p className="text-[11px] text-muted-foreground">
                  Spend is OFF — sellers are not charged, but buyer discovery still requires available credits at or above the activation floor. Health labels below are seller-facing warnings only.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Spend is ON — products drop out of buyer discovery when available credits are ₹0 or below the activation floor
                    {orderCompletedRule?.enabled
                      ? ` (currently ${formatPrice(discoveryActivationMin ?? 0)} from the enabled Order completed billing rate).`
                      : ' (any balance above ₹0 when Order completed billing is disabled).'}
                    {' '}Health thresholds below are warnings only — they do not hide listings.
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                    <li>
                      <span className="font-medium text-foreground">healthy_min</span> ({formatPrice(healthyMinDisplay)}): below this → Low label (warning, not a block).
                    </li>
                    <li>
                      <span className="font-medium text-foreground">low_min</span> ({formatPrice(lowMinDisplay)}): below this → Critical label (still a warning, not a block).
                    </li>
                    <li>
                      <span className="font-medium text-foreground">critical_min</span>: at or above 0 and at/below this → Critical label (still a warning, not a block).
                    </li>
                  </ul>
                  <p className="text-[11px] text-muted-foreground">
                    Examples with current settings: ₹0 → hidden from buyers; {formatPrice(midBalanceExample)} → still visible (above activation floor) but Critical/Low warnings on the seller credits page; {formatPrice(healthyMinDisplay)} → visible and Healthy.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    New sellers with no recharge: not visible until balance meets the activation floor. Sellers see “Recharge Sociva Credits to make your store visible”; buyers see a generic unavailable message.
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={healthyMin || thresholdValue('healthy_min')} onChange={(e) => setHealthyMin(e.target.value)} placeholder="Healthy min" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('healthy_min', healthyMin, 'Healthy threshold')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Healthy min: available below this is Low (warning only — products stay visible).</p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={lowMin || thresholdValue('low_min')} onChange={(e) => setLowMin(e.target.value)} placeholder="Low/critical boundary" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('low_min', lowMin, 'Low/critical boundary')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Low/critical boundary (`low_min`): available below this is Critical (still a warning, not a block).</p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={criticalMin || thresholdValue('critical_min')} onChange={(e) => setCriticalMin(e.target.value)} placeholder="Critical max" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('critical_min', criticalMin, 'Critical threshold')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Critical max (`critical_min`): available at or below this (and above 0) is Critical (warning only — products stay visible).</p>
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="packages" className="space-y-4 mt-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Credit packages</p>
            <p className="text-xs text-muted-foreground">Price is what Razorpay charges. Credits granted can differ. Past purchases keep their snapshot. Deactivate hides a package from new recharges only.</p>
            {(flagsQuery.data?.packages || []).map((pack: any) => (
              <div key={pack.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{pack.label} · pay {formatPrice(Number(pack.amount))} · credits {formatPrice(Number(pack.credits_amount ?? pack.amount))} {pack.is_active ? '' : '· off'}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => {
                    setEditingPkg(pack.id);
                    setPkgLabel(pack.label || '');
                    setPkgPrice(String(pack.amount ?? ''));
                    setPkgCredits(String(pack.credits_amount ?? pack.amount ?? ''));
                    setPkgSort(String(pack.sort_order ?? ''));
                  }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => togglePackage(pack, !pack.is_active)}>
                    {pack.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            ))}
            <Input value={pkgLabel} onChange={(e) => setPkgLabel(e.target.value)} placeholder="Package name" />
            <div className="flex gap-2">
              <Input type="number" min="0" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="Price" />
              <Input type="number" min="0" value={pkgCredits} onChange={(e) => setPkgCredits(e.target.value)} placeholder="Credits" />
              <Input type="number" value={pkgSort} onChange={(e) => setPkgSort(e.target.value)} placeholder="Order" />
            </div>
            <Button size="sm" onClick={() => savePackage(true)}>{editingPkg ? 'Update package' : 'Add package'}</Button>
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4 mt-0">
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Configuration history</p>
            <p className="text-xs text-muted-foreground">Rate, setting, threshold, package, adjustment, refund, and reversal configuration events. This is not the full financial ledger.</p>
            <PaginatedList
              items={flagsQuery.data?.audit || []}
              emptyLabel="No billing changes yet"
              itemLabel="events"
              renderItem={(row: any) => (
                <p key={row.id} className="text-[11px] text-muted-foreground rounded-md border px-2 py-1.5">
                  {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : ''} · {row.event_type}
                  {row.new_amount != null ? ` · ${formatPrice(Number(row.new_amount))}` : ''}
                  {row.reason ? ` · ${row.reason}` : ''}
                </p>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Unified financial timeline</p>
            <p className="text-xs text-muted-foreground">
              Merged ledger movements and captured purchases across all stores — use this for financial audit.
            </p>
            <PaginatedList
              items={flagsQuery.data?.timeline || []}
              emptyLabel="No financial timeline entries yet"
              itemLabel="entries"
              renderItem={(row: any, index) => (
                <p key={`${row.source}-${row.reference_id}-${row.occurred_at}-${index}`} className="text-[11px] text-muted-foreground rounded-md border px-2 py-1.5">
                  {row.occurred_at ? format(new Date(row.occurred_at), 'MMM d, yyyy · h:mm a') : ''} · {row.business_name} · {row.source}/{row.event_kind}
                  {row.event_type ? `/${row.event_type}` : ''} · {formatPrice(Number(row.amount) || 0)}
                  {row.balance_after != null ? ` · after ${formatPrice(Number(row.balance_after) || 0)}` : ''}
                  {row.description ? ` · ${row.description}` : ''}
                </p>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Financial activity</p>
            <p className="text-xs text-muted-foreground">Ledger of purchases, charges, reservations, releases, refunds, reversals, and admin adjustments.</p>
            <PaginatedList
              items={flagsQuery.data?.ledger || []}
              emptyLabel="No credit ledger entries yet"
              itemLabel="entries"
              renderItem={(row: any) => (
                <p key={row.id} className="text-[11px] text-muted-foreground rounded-md border px-2 py-1.5">
                  {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : ''} · {row.business_name} · {row.type}
                  {row.event_type ? `/${row.event_type}` : ''} · {formatPrice(Number(row.amount) || 0)} · after {formatPrice(Number(row.balance_after) || 0)}
                  {row.description ? ` · ${row.description}` : ''}
                </p>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Credit purchases</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={purchaseSearch}
                onChange={(e) => setPurchaseSearch(e.target.value)}
                placeholder="Search store name, purchase id, or payment ref"
                className="pl-9"
              />
            </div>
            <PaginatedList
              items={purchasesQuery.data || []}
              emptyLabel={purchasesQuery.isLoading ? 'Loading purchases…' : 'No credit purchases yet'}
              itemLabel="purchases"
              renderItem={(row: any) => (
                <div key={row.id} className="rounded-lg border p-2 text-[11px] space-y-0.5">
                  <p className="font-medium text-sm">{row.business_name}</p>
                  <p>Purchase {row.id}</p>
                  <p>Paid {formatPrice(Number(row.amount) || 0)} · Credits {formatPrice(Number(row.credits_granted) || 0)} · {row.status}</p>
                  <p>{row.provider} · {row.provider_payment_id || 'no payment ref'} · {row.provider_order_id || 'no order ref'}</p>
                  <p>Created {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : '—'}</p>
                  {row.captured_at && <p>Confirmed {format(new Date(row.captured_at), 'MMM d, yyyy · h:mm a')}</p>}
                  {row.failure_reason && <p>Failed {row.failure_reason}</p>}
                  {row.status === 'captured' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 h-7 text-xs"
                      onClick={() => {
                        setRefundPurchase(row.id);
                        setRefundReason((prev) => prev || `Admin refund · ${row.business_name}`);
                        setActiveTab('stores');
                      }}
                    >
                      Use for refund
                    </Button>
                  )}
                </div>
              )}
            />
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="stores" className="space-y-4 mt-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Store lookup</p>
            <p className="text-xs text-muted-foreground">
              Search by store name, seller phone, or id. Pick a store for adjustments and reversals — you do not need to copy UUIDs manually.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="Search stores by name, phone, or id"
                className="pl-9"
              />
            </div>
            {storeSearch.trim().length === 0 && (
              <p className="text-xs text-muted-foreground">Type at least one character to search stores.</p>
            )}
            {sellersQuery.isLoading && storeSearch.trim().length > 0 && (
              <p className="text-xs text-muted-foreground">Searching stores…</p>
            )}
            {!sellersQuery.isLoading && storeSearch.trim().length > 0 && (sellersQuery.data || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No stores match that search.</p>
            )}
            {(sellersQuery.data || []).slice(0, 20).map((row: AdminStoreCreditRow) => (
              <div
                key={row.seller_id}
                className={`rounded-lg border p-3 space-y-2 ${activeStoreId === row.seller_id ? 'border-primary/50 bg-primary/5' : ''}`}
              >
                <div>
                  <p className="text-sm font-medium">{row.business_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.seller_phone ? `${row.seller_phone} · ` : ''}{row.seller_id}
                  </p>
                  <p className="text-xs mt-1">
                    Available {formatPrice(Number(row.available) || 0)} · Reserved {formatPrice(Number(row.reserved) || 0)} · Used {formatPrice(Number(row.lifetime_consumed) || 0)}
                  </p>
                  {row.last_recharge_at && (
                    <p className="text-[11px] text-muted-foreground">Last recharge {format(new Date(row.last_recharge_at), 'MMM d, yyyy')}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => selectStoreFor('adjust', row)}>Use for adjustment</Button>
                  <Button size="sm" variant="ghost" onClick={() => selectStoreFor('reverse', row)}>Use for reversal</Button>
                </div>
              </div>
            ))}
            {storeSearch.trim().length > 0 && (sellersQuery.data || []).length > 20 && (
              <p className="text-[11px] text-muted-foreground">Showing first 20 matches. Refine your search to narrow further.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Admin refund of unused purchase</p>
            <p className="text-xs text-muted-foreground">
              Pick a captured purchase from the Activity tab, or paste an id here. V1: refunds only if the seller still has unused credits covering the granted amount.
            </p>
            <Input value={refundPurchase} onChange={(e) => setRefundPurchase(e.target.value)} placeholder="Captured purchase id" />
            <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason required" />
            <Button size="sm" variant="outline" onClick={refundCaptured}>Refund unused credits</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Charge reversal</p>
            <p className="text-xs text-muted-foreground">
              Reverses a committed event charge (order, enquiry, booking, or contact). The original ledger row stays. A separate reversal is added. Adjustments are not reversals.
            </p>
            {(flagsQuery.data?.charges || []).slice(0, 8).map((row: any) => (
              <button
                type="button"
                key={row.id}
                className="block w-full text-left rounded-lg border p-2 text-[11px]"
                onClick={() => {
                  setReverseSeller(row.seller_id);
                  setActiveStoreId(row.seller_id);
                  setReverseEvent(row.event_type);
                  setReverseRefType(row.reference_type);
                  setReverseRefId(row.reference_id);
                }}
              >
                {row.business_name} · {row.event_type} · {formatPrice(Number(row.amount) || 0)} · {row.reference_id}
              </button>
            ))}
            <AdminStoreSearchPicker
              value={reverseSeller}
              onChange={(sellerId) => {
                setReverseSeller(sellerId);
                setActiveStoreId(sellerId);
              }}
              helperText="Search by store name, phone, or id. Recent charges above also pre-fill this."
            />
            {reverseSeller && reverseRefId && (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] space-y-0.5">
                <p className="font-medium text-xs">Reversal preview</p>
                <p>Seller: {selectedReverseCharge?.business_name || reverseSeller}</p>
                <p>Event: {reverseEvent} · Reference: {reverseRefType}/{reverseRefId}</p>
                {selectedReverseCharge && (
                  <p>Original charge: {formatPrice(Number(selectedReverseCharge.amount) || 0)} — a separate reversal ledger row will be added; the original charge stays.</p>
                )}
              </div>
            )}
            <Input value={reverseEvent} onChange={(e) => setReverseEvent(e.target.value)} placeholder="Event type" />
            <Input value={reverseRefType} onChange={(e) => setReverseRefType(e.target.value)} placeholder="Reference type (order/contact)" />
            <Input value={reverseRefId} onChange={(e) => setReverseRefId(e.target.value)} placeholder="Original reference id" />
            <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Reason required" />
            <Button onClick={reverseCharge}>Reverse charge</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Admin adjustment</p>
            <p className="text-xs text-muted-foreground">
              Use for goodwill or balance corrections that are not reversing a specific charge. Reason is required. Negative balances are rejected. V1 cap: ₹50,000 per adjustment. Each submit sends a unique request id so a double-click does not post twice.
            </p>
            <AdminStoreSearchPicker
              value={adjustSeller}
              onChange={(sellerId) => {
                setAdjustSeller(sellerId);
                setActiveStoreId(sellerId);
              }}
              helperText="Search by store name, phone, or id. Store lookup above can also pre-fill this."
            />
            <Input value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Amount (positive)" />
            <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Reason required" />
            <div className="flex gap-2">
              <Button onClick={() => adjust('add')}>Add credits</Button>
              <Button variant="outline" onClick={() => adjust('remove')}>Remove credits</Button>
            </div>
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
