// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Ticket, X, Check, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { feedbackCouponApplied, feedbackCouponFailed } from '@/lib/feedbackEngine';

interface CouponData {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  max_discount_amount: number | null;
  min_order_amount: number | null;
  expires_at: string | null;
  starts_at: string;
  usage_limit: number | null;
  times_used: number;
  per_user_limit: number;
  show_to_buyers: boolean;
}

interface AppliedCouponData {
  id: string;
  code: string;
  discountAmount: number;
  discount_type?: string;
  discount_value?: number;
  max_discount_amount?: number | null;
  min_order_amount?: number | null;
}

interface CouponInputProps {
  sellerId: string;
  totalAmount: number;
  onApply: (coupon: AppliedCouponData) => void;
  onRemove: () => void;
  appliedCoupon: AppliedCouponData | null;
}

export function CouponInput({ sellerId, totalAmount, onApply, onRemove, appliedCoupon }: CouponInputProps) {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [availableCoupons, setAvailableCoupons] = useState<CouponData[]>([]);
  const [showAvailable, setShowAvailable] = useState(false);
  const [userRedemptions, setUserRedemptions] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function fetchCoupons() {
      const { data } = await supabase.from('coupons').select('id, code, description, discount_type, discount_value, max_discount_amount, min_order_amount, expires_at, starts_at, usage_limit, times_used, per_user_limit, show_to_buyers').eq('seller_id', sellerId).eq('is_active', true).eq('show_to_buyers', true);
      if (cancelled || !data) return;
      const now = new Date();
      const valid = (data as CouponData[]).filter(c => {
        if (c.expires_at && new Date(c.expires_at) < now) return false;
        if (new Date(c.starts_at) > now) return false;
        if (c.usage_limit && c.times_used >= c.usage_limit) return false;
        return true;
      });
      setAvailableCoupons(valid);
      if (valid.length > 0) {
        const { data: redemptions } = await supabase.from('coupon_redemptions').select('coupon_id').eq('user_id', user!.id).in('coupon_id', valid.map(c => c.id));
        if (!cancelled && redemptions) {
          const counts: Record<string, number> = {};
          redemptions.forEach(r => { counts[r.coupon_id] = (counts[r.coupon_id] || 0) + 1; });
          setUserRedemptions(counts);
        }
      }
    }
    fetchCoupons();
    return () => { cancelled = true; };
  }, [sellerId, user]);

  const calculateDiscount = (coupon: CouponData) => {
    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      const clampedPct = Math.min(coupon.discount_value, 100);
      discount = (totalAmount * clampedPct) / 100;
      if (coupon.max_discount_amount) discount = Math.min(discount, coupon.max_discount_amount);
    } else { discount = Math.min(coupon.discount_value, totalAmount); }
    return Math.round(discount * 100) / 100;
  };

  const canApplyCoupon = (coupon: CouponData) => {
    if (coupon.min_order_amount && totalAmount < coupon.min_order_amount) return false;
    if ((userRedemptions[coupon.id] || 0) >= coupon.per_user_limit) return false;
    return true;
  };

  const applyCouponDirectly = (coupon: CouponData) => {
    if (!canApplyCoupon(coupon)) {
      if (coupon.min_order_amount && totalAmount < coupon.min_order_amount) feedbackCouponFailed(`Minimum order of ${formatPrice(coupon.min_order_amount)} required`);
      else feedbackCouponFailed('You have already used this coupon');
      return;
    }
    const discountAmount = calculateDiscount(coupon);
    onApply({ id: coupon.id, code: coupon.code, discountAmount, discount_type: coupon.discount_type, discount_value: coupon.discount_value, max_discount_amount: coupon.max_discount_amount, min_order_amount: coupon.min_order_amount });
    feedbackCouponApplied(formatPrice(discountAmount));
  };

  const handleApply = async () => {
    if (!code.trim() || !user) return;
    setIsValidating(true);
    try {
      const { data: coupon, error } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase().trim()).eq('seller_id', sellerId).eq('is_active', true).single();
      if (error || !coupon) { feedbackCouponFailed('Invalid or expired coupon code'); return; }
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) { feedbackCouponFailed('This coupon has expired'); return; }
      if (new Date(coupon.starts_at) > new Date()) { feedbackCouponFailed('This coupon is not yet active'); return; }
      if (coupon.usage_limit && coupon.times_used >= coupon.usage_limit) { feedbackCouponFailed('This coupon has reached its usage limit'); return; }
      const { count } = await supabase.from('coupon_redemptions').select('*', { count: 'exact', head: true }).eq('coupon_id', coupon.id).eq('user_id', user.id);
      if (count !== null && count >= coupon.per_user_limit) { feedbackCouponFailed('You have already used this coupon'); return; }
      if (coupon.min_order_amount && totalAmount < coupon.min_order_amount) { feedbackCouponFailed(`Minimum order of ${formatPrice(coupon.min_order_amount)} required`); return; }
      let discountAmount = 0;
      if (coupon.discount_type === 'percentage') {
        discountAmount = (totalAmount * coupon.discount_value) / 100;
        if (coupon.max_discount_amount) discountAmount = Math.min(discountAmount, coupon.max_discount_amount);
      } else { discountAmount = Math.min(coupon.discount_value, totalAmount); }
      discountAmount = Math.round(discountAmount * 100) / 100;
      onApply({ id: coupon.id, code: coupon.code, discountAmount, discount_type: coupon.discount_type, discount_value: coupon.discount_value, max_discount_amount: coupon.max_discount_amount, min_order_amount: coupon.min_order_amount });
      feedbackCouponApplied(formatPrice(discountAmount));
    } catch { feedbackCouponFailed('Failed to validate coupon'); }
    finally { setIsValidating(false); }
  };

  if (appliedCoupon) {
    return (
      <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <Check className="text-primary" size={18} />
          <div>
            <span className="font-mono font-bold text-primary text-sm">{appliedCoupon.code}</span>
            <p className="text-xs text-muted-foreground">You save {formatPrice(appliedCoupon.discountAmount)}</p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onRemove}><X size={16} /></Button>
      </div>
    );
  }

  const eligibleCoupons = availableCoupons.filter(c => canApplyCoupon(c));
  const ineligibleCoupons = availableCoupons.filter(c => !canApplyCoupon(c));

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input placeholder="Enter coupon code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="pl-9 uppercase" />
        </div>
        <Button variant="outline" onClick={handleApply} disabled={isValidating || !code.trim()}>{isValidating ? 'Checking...' : 'Apply'}</Button>
      </div>
      {availableCoupons.length > 0 && (
        <button onClick={() => setShowAvailable(!showAvailable)} className="flex items-center gap-2 w-full text-left text-sm font-medium text-primary py-1.5">
          <Tag size={14} /><span>{availableCoupons.length} coupon{availableCoupons.length !== 1 ? 's' : ''} available</span>
          {showAvailable ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
        </button>
      )}
      {showAvailable && availableCoupons.length > 0 && (
        <div className="space-y-2">
          {eligibleCoupons.map(coupon => (
            <div key={coupon.id} className="border border-dashed border-primary/30 bg-primary/5 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><span className="font-mono font-bold text-primary text-sm tracking-wide">{coupon.code}</span></div>
                {coupon.description && <p className="text-xs text-foreground/80 mt-0.5 line-clamp-2">{coupon.description}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off${coupon.max_discount_amount ? ` (up to ${formatPrice(coupon.max_discount_amount)})` : ''}` : `${formatPrice(coupon.discount_value)} off`}
                  {coupon.min_order_amount ? ` · Min order ${formatPrice(coupon.min_order_amount)}` : ''}
                </p>
                <p className="text-xs font-medium text-primary mt-1">You save {formatPrice(calculateDiscount(coupon))}</p>
              </div>
              <Button size="sm" variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground shrink-0 text-xs h-8 px-3" onClick={() => applyCouponDirectly(coupon)}>Apply</Button>
            </div>
          ))}
          {ineligibleCoupons.map(coupon => {
            const isMinOrder = coupon.min_order_amount && totalAmount < coupon.min_order_amount;
            return (
              <div key={coupon.id} className="border border-dashed border-border bg-muted/50 rounded-xl p-3 opacity-60">
                <div className="flex items-center gap-2"><span className="font-mono font-bold text-muted-foreground text-sm tracking-wide">{coupon.code}</span></div>
                {coupon.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{coupon.description}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off${coupon.max_discount_amount ? ` (up to ${formatPrice(coupon.max_discount_amount)})` : ''}` : `${formatPrice(coupon.discount_value)} off`}
                </p>
                <p className="text-xs text-destructive mt-1">{isMinOrder ? `Add ${formatPrice(coupon.min_order_amount! - totalAmount)} more to unlock` : 'Already used'}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
