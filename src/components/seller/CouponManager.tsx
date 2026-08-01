// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ticket, Plus, Trash2, Copy, Eye, EyeOff, Users, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useCurrency } from '@/hooks/useCurrency';

interface CouponPerformance {
  coupon_id: string;
  redemption_count: number;
  total_discount: number;
  total_order_value: number;
}

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  min_order_amount: number | null;
  max_discount_amount: number | null;
  usage_limit: number | null;
  times_used: number;
  per_user_limit: number;
  is_active: boolean;
  show_to_buyers: boolean;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

export function CouponManager() {
  const { currentSellerId, profile, viewAsSocietyId } = useAuth();
  const { formatPrice, currencySymbol } = useCurrency();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [performance, setPerformance] = useState<Map<string, CouponPerformance>>(new Map());
  const [expandedPerf, setExpandedPerf] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    code: '',
    description: '',
    discount_type: 'percentage',
    discount_value: '',
    min_order_amount: '',
    max_discount_amount: '',
    usage_limit: '',
    per_user_limit: '1',
    expires_at: '',
    show_to_buyers: true,
  });

  useEffect(() => {
    if (currentSellerId) {
      fetchCoupons();
      fetchPerformance();
    }
  }, [currentSellerId]);

  const fetchCoupons = async () => {
    if (!currentSellerId) return;
    const { data, error } = await supabase
      .from('coupons')
      .select('id, code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, times_used, per_user_limit, is_active, show_to_buyers, starts_at, expires_at, created_at')
      .eq('seller_id', currentSellerId)
      .order('created_at', { ascending: false });
    if (!error) setCoupons((data as Coupon[]) || []);
    setIsLoading(false);
  };

  const fetchPerformance = async () => {
    if (!currentSellerId) return;
    const { data } = await supabase
      .from('coupon_redemptions')
      .select('coupon_id, discount_applied, order_id, orders!inner(total_amount)')
      .eq('orders.seller_id', currentSellerId);
    if (!data) return;
    const map = new Map<string, CouponPerformance>();
    for (const r of data as any[]) {
      const existing = map.get(r.coupon_id) || { coupon_id: r.coupon_id, redemption_count: 0, total_discount: 0, total_order_value: 0 };
      existing.redemption_count++;
      existing.total_discount += r.discount_applied || 0;
      existing.total_order_value += r.orders?.total_amount || 0;
      map.set(r.coupon_id, existing);
    }
    setPerformance(map);
  };

  const togglePerfExpanded = (id: string) => {
    setExpandedPerf(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!currentSellerId) {
      toast.error('Missing seller information');
      return;
    }
    if (!formData.code || !formData.discount_value) {
      toast.error('Code and discount value are required');
      return;
    }
    const discountVal = Number(formData.discount_value);
    if (discountVal <= 0) {
      toast.error('Discount value must be greater than 0');
      return;
    }
    if (formData.discount_type === 'percentage' && discountVal > 100) {
      toast.error('Percentage discount cannot exceed 100%');
      return;
    }
    if (formData.discount_type === 'fixed' && discountVal > 1000 && !formData.max_discount_amount) {
      toast.warning('High fixed discount (₹' + discountVal + ') without a max cap. Consider setting a "Max Discount Amount" to avoid confusion.');
    }

    const { error } = await supabase.from('coupons').insert({
      seller_id: currentSellerId,
      society_id: profile?.society_id || null,
      code: formData.code.toUpperCase().trim(),
      description: formData.description.trim() || null,
      discount_type: formData.discount_type,
      discount_value: Number(formData.discount_value),
      min_order_amount: formData.min_order_amount ? Number(formData.min_order_amount) : 0,
      max_discount_amount: formData.max_discount_amount ? Number(formData.max_discount_amount) : null,
      usage_limit: formData.usage_limit ? Number(formData.usage_limit) : null,
      per_user_limit: Number(formData.per_user_limit) || 1,
      expires_at: formData.expires_at || null,
      show_to_buyers: formData.show_to_buyers,
    });

    if (error) {
      if (error.message.includes('unique')) toast.error('This coupon code already exists for your store');
      else toast.error('Failed to create coupon');
      return;
    }

    toast.success('Coupon created!');
    setShowForm(false);
    setFormData({ code: '', description: '', discount_type: 'percentage', discount_value: '', min_order_amount: '', max_discount_amount: '', usage_limit: '', per_user_limit: '1', expires_at: '', show_to_buyers: true });
    fetchCoupons();
  };

  const toggleCoupon = async (id: string, isActive: boolean) => {
    if (!currentSellerId) return;
    await supabase.from('coupons').update({ is_active: !isActive }).eq('id', id).eq('seller_id', currentSellerId);
    setCoupons(coupons.map(c => c.id === id ? { ...c, is_active: !isActive } : c));
  };

  const toggleVisibility = async (id: string, current: boolean) => {
    if (!currentSellerId) return;
    await supabase.from('coupons').update({ show_to_buyers: !current }).eq('id', id).eq('seller_id', currentSellerId);
    setCoupons(coupons.map(c => c.id === id ? { ...c, show_to_buyers: !current } : c));
    toast.success(!current ? 'Coupon now visible to buyers at checkout' : 'Coupon hidden — buyers must enter code manually');
  };

  const deleteCoupon = async (id: string) => {
    if (!currentSellerId) return;
    await supabase.from('coupons').delete().eq('id', id).eq('seller_id', currentSellerId);
    setCoupons(coupons.filter(c => c.id !== id));
    toast.success('Coupon deleted');
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Code copied!');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Ticket className="text-primary" size={20} />
          Promotions & Coupons
        </h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)} disabled={!!viewAsSocietyId}>
          <Plus size={16} className="mr-1" />
          {showForm ? 'Cancel' : 'New Coupon'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Code</Label>
                <Input placeholder="e.g. WELCOME10" value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} className="uppercase" />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={formData.discount_type} onValueChange={v => setFormData({ ...formData, discount_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="flat">Flat ({currencySymbol})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs">Description <span className="text-muted-foreground">(shown to buyers)</span></Label>
              <Textarea
                placeholder="e.g. Weekend special! Get extra off on all orders"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="text-sm"
                maxLength={120}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5 text-right">{formData.description.length}/120</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Discount Value</Label>
                <Input type="number" placeholder={formData.discount_type === 'percentage' ? '10' : '50'} value={formData.discount_value} onChange={e => setFormData({ ...formData, discount_value: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Min Order ({currencySymbol})</Label>
                <Input type="number" placeholder="0" value={formData.min_order_amount} onChange={e => setFormData({ ...formData, min_order_amount: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Max Discount ({currencySymbol})</Label>
                <Input type="number" placeholder="No limit" value={formData.max_discount_amount} onChange={e => setFormData({ ...formData, max_discount_amount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Usage Limit</Label>
                <Input type="number" placeholder="Unlimited" value={formData.usage_limit} onChange={e => setFormData({ ...formData, usage_limit: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Per User Limit</Label>
                <Input type="number" value={formData.per_user_limit} onChange={e => setFormData({ ...formData, per_user_limit: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Expires At</Label>
                <Input type="datetime-local" value={formData.expires_at} onChange={e => setFormData({ ...formData, expires_at: e.target.value })} />
              </div>
            </div>

            {/* Visibility toggle */}
            <div className="flex items-center justify-between bg-muted rounded-lg p-3">
              <div className="flex items-center gap-2">
                {formData.show_to_buyers ? <Eye size={16} className="text-primary" /> : <EyeOff size={16} className="text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">Show to buyers at checkout</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formData.show_to_buyers ? 'Buyers will see this coupon and can apply with one tap' : 'Buyers must enter the code manually to use it'}
                  </p>
                </div>
              </div>
              <Switch checked={formData.show_to_buyers} onCheckedChange={v => setFormData({ ...formData, show_to_buyers: v })} />
            </div>

            <Button onClick={handleCreate} className="w-full">Create Coupon</Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Loading coupons...</p>
      ) : coupons.length === 0 ? (
        <div className="text-center py-8 bg-muted rounded-xl">
          <Ticket className="mx-auto text-muted-foreground mb-2" size={32} />
          <p className="text-sm text-muted-foreground">No coupons yet. Create one to attract more customers!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((coupon) => (
            <Card key={coupon.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-bold text-primary">{coupon.code}</span>
                      <button onClick={() => copyCode(coupon.code)}><Copy size={14} className="text-muted-foreground" /></button>
                      <Badge variant={coupon.is_active ? 'default' : 'secondary'}>
                        {coupon.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {coupon.show_to_buyers ? (
                        <Badge variant="outline" className="gap-1 text-[10px]"><Eye size={10} />Visible</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><EyeOff size={10} />Hidden</Badge>
                      )}
                    </div>
                    {coupon.description && (
                      <p className="text-xs text-foreground/80 mb-1">{coupon.description}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `${formatPrice(coupon.discount_value)} off`}
                      {coupon.min_order_amount ? ` on orders above ${formatPrice(coupon.min_order_amount)}` : ''}
                      {coupon.max_discount_amount ? ` (max ${formatPrice(coupon.max_discount_amount)})` : ''}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-xs text-muted-foreground">
                        <Users size={10} className="inline mr-0.5" />
                        Used: {coupon.times_used}{coupon.usage_limit ? `/${coupon.usage_limit}` : ''} times
                      </p>
                      {coupon.expires_at && (
                        <p className="text-xs text-muted-foreground">
                          Expires: {format(new Date(coupon.expires_at), 'dd MMM yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <Switch checked={coupon.is_active} onCheckedChange={() => toggleCoupon(coupon.id, coupon.is_active)} />
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => toggleVisibility(coupon.id, coupon.show_to_buyers)}
                        title={coupon.show_to_buyers ? 'Hide from buyers' : 'Show to buyers'}
                      >
                        {coupon.show_to_buyers ? <Eye size={14} className="text-primary" /> : <EyeOff size={14} className="text-muted-foreground" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="text-destructive h-7 w-7" onClick={() => deleteCoupon(coupon.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
                {/* Performance Stats */}
                {performance.has(coupon.id) && (
                  <div className="mt-2 border-t border-border pt-2">
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePerfExpanded(coupon.id); }} className="flex items-center gap-1 text-[10px] text-primary font-medium w-full">
                      <TrendingUp size={10} />
                      Performance
                      {expandedPerf.has(coupon.id) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                    {expandedPerf.has(coupon.id) && (() => {
                      const p = performance.get(coupon.id)!;
                      return (
                        <div className="grid grid-cols-3 gap-2 mt-1.5">
                          <div className="bg-muted rounded-lg px-2 py-1.5 text-center">
                            <p className="text-xs font-bold tabular-nums">{p.redemption_count}</p>
                            <p className="text-[9px] text-muted-foreground">Redeemed</p>
                          </div>
                          <div className="bg-muted rounded-lg px-2 py-1.5 text-center">
                            <p className="text-xs font-bold tabular-nums">{formatPrice(p.total_discount)}</p>
                            <p className="text-[9px] text-muted-foreground">Discounts</p>
                          </div>
                          <div className="bg-muted rounded-lg px-2 py-1.5 text-center">
                            <p className="text-xs font-bold tabular-nums">{formatPrice(p.total_order_value)}</p>
                            <p className="text-[9px] text-muted-foreground">Orders</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
