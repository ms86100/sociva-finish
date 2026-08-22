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

const adminRpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

type BillingRule = {
  event_type: BillingEventType;
  enabled: boolean;
  amount: number;
  updated_at?: string | null;
  updated_by?: string | null;
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
      return {
        rules: (data || []) as BillingRule[],
        purchaseEnabled: Boolean(purchase.data),
        spendEnabled: Boolean(spend.data),
        settings: Array.isArray(settings.data) ? settings.data : [],
        audit: Array.isArray(audit.data) ? audit.data : [],
        thresholds: Array.isArray(thresholds.data) ? thresholds.data : [],
        packages: Array.isArray(packages.data) ? packages.data : [],
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

  const savePackage = async () => {
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
      p_is_active: true,
      p_sort_order: Number.isFinite(sort) ? sort : 100,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Package saved. Historical purchases keep the amount they bought.');
      setEditingPkg(null);
      setPkgLabel('');
      setPkgPrice('');
      setPkgCredits('');
      refresh();
    }
  };

  const setFlag = async (key: string, enabled: boolean) => {
    const { error } = await adminRpc('admin_set_seller_credit_flag', { p_key: key, p_enabled: enabled });
    if (error) toast.error(error.message);
    else refresh();
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

  const adjust = async () => {
    const amount = Number(adjustAmount);
    if (!adjustSeller || !Number.isFinite(amount) || amount === 0 || !adjustReason.trim()) {
      toast.error('Seller, non-zero amount, and reason are required.');
      return;
    }
    const { error } = await adminRpc('admin_adjust_seller_credits', {
      p_seller_id: adjustSeller,
      p_amount: amount,
      p_reason: adjustReason.trim(),
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Adjustment recorded.');
      setAdjustAmount('');
      setAdjustReason('');
      refresh();
    }
  };

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
            <div className="flex items-center justify-between">
              <span className="text-sm">Purchase enabled</span>
              <Switch checked={!!flagsQuery.data?.purchaseEnabled} onCheckedChange={(v) => setFlag('seller_credit_purchase_enabled', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Spend / gating enabled</span>
              <Switch checked={!!flagsQuery.data?.spendEnabled} onCheckedChange={(v) => setFlag('seller_credit_spend_enabled', v)} />
            </div>
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
            <p className="text-xs text-muted-foreground">These prices apply to future events only. No rate is read from application code.</p>
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
              Confirmed bookings reserve credits. After appointment + grace, unresolved bookings commit (value delivered). Buyer no-show commits. Seller cancel/failure releases. Disputes use admin reversal — no second booking workflow.
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
                value={noShowPolicy || settingMap.buyer_no_show_policy?.value || ''}
                onChange={(e) => setNoShowPolicy(e.target.value)}
              >
                <option value="commit">Buyer no-show: commit reserved credits</option>
                <option value="charge">Buyer no-show: commit reserved credits</option>
                <option value="release">Buyer no-show: release reservation</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveSetting(
                  'buyer_no_show_policy',
                  noShowPolicy || settingMap.buyer_no_show_policy?.value || '',
                  'Buyer no-show policy',
                )}
              >
                Save policy
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Seller cancellation / seller failure releases the reservation. Contact debounce is the locked 24-hour V1 window (admin-visible as contact_debounce_hours). Dispute after commit uses admin reversal.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Health thresholds</p>
            <p className="text-xs text-muted-foreground">Exhausted is always available ≤ 0. These bands drive seller health and low/exhausted notifications.</p>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={healthyMin || thresholdValue('healthy_min')} onChange={(e) => setHealthyMin(e.target.value)} placeholder="Healthy min" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('healthy_min', healthyMin, 'Healthy threshold')}>Save</Button>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={lowMin || thresholdValue('low_min')} onChange={(e) => setLowMin(e.target.value)} placeholder="Low min" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('low_min', lowMin, 'Low threshold')}>Save</Button>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" value={criticalMin || thresholdValue('critical_min')} onChange={(e) => setCriticalMin(e.target.value)} placeholder="Critical min" />
              <Button size="sm" variant="outline" onClick={() => saveThreshold('critical_min', criticalMin, 'Critical threshold')}>Save</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Credit packages</p>
            <p className="text-xs text-muted-foreground">Price is what Razorpay charges. Credits granted can differ. Past purchases keep their snapshot.</p>
            {(flagsQuery.data?.packages || []).map((pack: any) => (
              <div key={pack.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{pack.label} · pay {formatPrice(Number(pack.amount))} · credits {formatPrice(Number(pack.credits_amount ?? pack.amount))} {pack.is_active ? '' : '· off'}</span>
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditingPkg(pack.id);
                  setPkgLabel(pack.label || '');
                  setPkgPrice(String(pack.amount ?? ''));
                  setPkgCredits(String(pack.credits_amount ?? pack.amount ?? ''));
                  setPkgSort(String(pack.sort_order ?? ''));
                }}>Edit</Button>
              </div>
            ))}
            <Input value={pkgLabel} onChange={(e) => setPkgLabel(e.target.value)} placeholder="Package name" />
            <div className="flex gap-2">
              <Input type="number" min="0" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="Price" />
              <Input type="number" min="0" value={pkgCredits} onChange={(e) => setPkgCredits(e.target.value)} placeholder="Credits" />
              <Input type="number" value={pkgSort} onChange={(e) => setPkgSort(e.target.value)} placeholder="Order" />
            </div>
            <Button size="sm" onClick={savePackage}>{editingPkg ? 'Update package' : 'Add package'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Audit history</p>
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Admin adjustment</p>
            <Input value={adjustSeller} onChange={(e) => setAdjustSeller(e.target.value)} placeholder="Seller / store id" />
            <Input value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Amount (+ or -)" />
            <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Reason required" />
            <Button onClick={adjust}>Record adjustment</Button>
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
