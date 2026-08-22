import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { BILLING_EVENT_LABELS, type BillingEventType } from '@/lib/sellerCredits';
import { toast } from 'sonner';
import { format } from 'date-fns';

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
        resolutionReady: Boolean((ready.data as { ok?: boolean } | null)?.ok),
      };
    },
  });

  const sellersQuery = useQuery({
    queryKey: ['admin-seller-credits', storeSearch],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_credits', { p_search: storeSearch || null });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  });

  const purchasesQuery = useQuery({
    queryKey: ['admin-seller-credit-purchases', purchaseSearch],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_credit_purchases', {
        p_search: purchaseSearch || null,
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

  const setFlag = async (key: string, enabled: boolean) => {
    if (key === 'seller_credit_spend_enabled' && enabled) {
      toast.error('Spend cannot be turned on from this screen until the go-live checklist is signed off separately.');
      return;
    }
    try {
      const { error } = await adminRpc('admin_set_seller_credit_flag', { p_key: key, p_enabled: enabled });
      if (error) toast.error(error.message);
      else {
        toast.success(
          key === 'seller_credit_purchase_enabled'
            ? (enabled ? 'Purchase enabled.' : 'Purchase disabled.')
            : 'Flag updated.',
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
      <div className="p-4 space-y-4">
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
              <Switch checked={spendOn} onCheckedChange={(v) => setFlag('seller_credit_spend_enabled', v)} />
            </div>
            {!spendOn && (
              <p className="text-xs text-amber-700">
                Spend is OFF. Sellers are not charged and buyers are not blocked for insufficient credits. Do not enable spend until purchase, ledger, refund, and reconciliation are proven.
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
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Billing rates</p>
            <p className="text-xs text-muted-foreground">
              Who pays: the seller, in Sociva Credits (not the buyer, not seller earnings). These prices apply to future events only. No rate is read from application code.
              Changing a rate does not rewrite existing reservations. If spend is disabled, rates are stored but not charged.
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
              V1 locked (not configurable): seller cancellation / seller failure always releases reserved credits. Disputes after commit use Admin reversal below — `seller_failure_policy` and `dispute_policy` are stored but ignored by runtime.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Health thresholds</p>
            <p className="text-xs text-muted-foreground">
              These bands label the seller balance and can send low/exhausted notifications. They do not block transactions and do not affect purchasing.
              Exhausted is always available ≤ 0. Critical is at or below Critical max, or below the Low/Critical boundary. Low is below Healthy min but at or above that boundary.
            </p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={healthyMin || thresholdValue('healthy_min')} onChange={(e) => setHealthyMin(e.target.value)} placeholder="Healthy min" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('healthy_min', healthyMin, 'Healthy threshold')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Healthy min: available below this is Low (warning).</p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={lowMin || thresholdValue('low_min')} onChange={(e) => setLowMin(e.target.value)} placeholder="Low/critical boundary" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('low_min', lowMin, 'Low/critical boundary')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Low/critical boundary (`low_min`): available below this is Critical (still a warning, not a block).</p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={criticalMin || thresholdValue('critical_min')} onChange={(e) => setCriticalMin(e.target.value)} placeholder="Critical max" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('critical_min', criticalMin, 'Critical threshold')}>Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Critical max (`critical_min`): available at or below this (and above 0) is Critical.</p>
          </CardContent>
        </Card>

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

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Configuration history</p>
            <p className="text-xs text-muted-foreground">Rate, setting, threshold, package, adjustment, refund, and reversal configuration events. This is not the full financial ledger.</p>
            {(flagsQuery.data?.audit || []).map((row: any) => (
              <p key={row.id} className="text-[11px] text-muted-foreground">
                {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : ''} · {row.event_type}
                {row.new_amount != null ? ` · ${formatPrice(Number(row.new_amount))}` : ''}
                {row.reason ? ` · ${row.reason}` : ''}
              </p>
            ))}
            {(flagsQuery.data?.audit || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No billing changes yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Financial activity</p>
            <p className="text-xs text-muted-foreground">Ledger of purchases, charges, reservations, releases, refunds, reversals, and admin adjustments.</p>
            {(flagsQuery.data?.ledger || []).map((row: any) => (
              <p key={row.id} className="text-[11px] text-muted-foreground">
                {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : ''} · {row.business_name} · {row.type}
                {row.event_type ? `/${row.event_type}` : ''} · {formatPrice(Number(row.amount) || 0)} · after {formatPrice(Number(row.balance_after) || 0)}
                {row.description ? ` · ${row.description}` : ''}
              </p>
            ))}
            {(flagsQuery.data?.ledger || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No credit ledger entries yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Credit purchases</p>
            <Input value={purchaseSearch} onChange={(e) => setPurchaseSearch(e.target.value)} placeholder="Search store, purchase id, payment ref" />
            {(purchasesQuery.data || []).map((row: any) => (
              <div key={row.id} className="rounded-lg border p-2 text-[11px] space-y-0.5">
                <p className="font-medium text-sm">{row.business_name}</p>
                <p>Purchase {row.id}</p>
                <p>Paid {formatPrice(Number(row.amount) || 0)} · Credits {formatPrice(Number(row.credits_granted) || 0)} · {row.status}</p>
                <p>{row.provider} · {row.provider_payment_id || 'no payment ref'} · {row.provider_order_id || 'no order ref'}</p>
                <p>Created {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy · h:mm a') : '—'}</p>
                {row.captured_at && <p>Confirmed {format(new Date(row.captured_at), 'MMM d, yyyy · h:mm a')}</p>}
                {row.failure_reason && <p>Failed {row.failure_reason}</p>}
              </div>
            ))}
            {!purchasesQuery.isLoading && (purchasesQuery.data || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No credit purchases yet</p>
            )}
            <p className="text-sm font-semibold pt-2">Admin refund of unused purchase</p>
            <p className="text-xs text-muted-foreground">
              V1: refunds a captured purchase only if the seller still has unused credits covering the granted amount. Spent credits cannot be clawed back here.
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
                  setReverseEvent(row.event_type);
                  setReverseRefType(row.reference_type);
                  setReverseRefId(row.reference_id);
                }}
              >
                {row.business_name} · {row.event_type} · {formatPrice(Number(row.amount) || 0)} · {row.reference_id}
              </button>
            ))}
            <Input value={reverseSeller} onChange={(e) => setReverseSeller(e.target.value)} placeholder="Seller / store id" />
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
              Use for goodwill or balance corrections that are not reversing a specific charge. Reason is required. Negative balances are rejected. Each submit sends a unique request id so a double-click does not post twice.
              Approval workflow and amount caps are not in V1.
            </p>
            <Input value={adjustSeller} onChange={(e) => setAdjustSeller(e.target.value)} placeholder="Seller / store id" />
            <Input value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Amount (positive)" />
            <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Reason required" />
            <div className="flex gap-2">
              <Button onClick={() => adjust('add')}>Add credits</Button>
              <Button variant="outline" onClick={() => adjust('remove')}>Remove credits</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Spend go-live checklist</p>
            <p className="text-xs text-muted-foreground">
              Informational only. This screen will not enable Spend. Marketplace charging stays off until a separate signed-off go-live.
            </p>
            <p className="text-xs">Purchase flag: {flagsQuery.isError ? 'could not load' : purchaseOn ? 'ON' : 'OFF'}</p>
            <p className="text-xs">Spend flag: {flagsQuery.isError ? 'could not load' : spendOn ? 'ON' : 'OFF (required until signed off)'}</p>
            <p className="text-xs">Booking resolution config: {flagsQuery.isError ? 'could not load' : flagsQuery.data?.resolutionReady ? 'ready' : 'incomplete'}</p>
            <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-1">
              <li>Still required before Spend: one live captured purchase with ledger + balance increase</li>
              <li>Still required: duplicate confirmation/webhook is proven idempotent on a real payment</li>
              <li>Still required: unused-credit refund against a captured purchase</li>
              <li>Still required: booking reserve/commit/release and order/enquiry/contact billing in a controlled test</li>
              <li>Still required: production web/app build that includes Spend-off seller copy</li>
            </ul>
          </CardContent>
        </Card>

        <Input value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)} placeholder="Search stores by name or id" />
        {(sellersQuery.data || []).map((row: any) => (
          <Card key={row.seller_id}>
            <CardContent className="p-3">
              <p className="text-sm font-medium">{row.business_name}</p>
              <p className="text-[11px] text-muted-foreground">{row.seller_id}</p>
              <p className="text-xs mt-1">
                Available {formatPrice(Number(row.available) || 0)} · Reserved {formatPrice(Number(row.reserved) || 0)} · Used {formatPrice(Number(row.lifetime_consumed) || 0)}
              </p>
              {row.last_recharge_at && (
                <p className="text-[11px] text-muted-foreground">Last recharge {format(new Date(row.last_recharge_at), 'MMM d, yyyy')}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
