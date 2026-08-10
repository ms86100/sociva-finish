// @ts-nocheck
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PaymentMethod } from '@/types/Database';
import { fetchStatusFlow, fetchStatusTransitions, statusFlowQueryKey, statusTransitionsQueryKey } from '@/hooks/useCategoryStatusFlow';
import { resolveTransactionType } from '@/lib/resolveTransactionType';
import { resolvePaymentConfig } from '@/lib/resolvePaymentConfig';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/contexts/AuthContext';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePaymentMode } from '@/hooks/usePaymentMode';
import { useCurrency } from '@/hooks/useCurrency';
import { useLoyaltyRedeem } from '@/hooks/useLoyaltyRedeem';
import { useWalletCredit } from '@/hooks/useWalletCredit';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { hapticImpact, hapticNotification, hapticSelection } from '@/lib/haptics';
import { toast } from 'sonner';
import { usePushNotifications } from '@/contexts/PushNotificationContext';
import { notify } from '@/lib/notify';
import { getString, setString, removeKey } from '@/lib/persistent-kv';
import {
  requiresSingleSellerForOnline,
  onlineMultiSellerBlockedMessage,
  multiStoreBannerCopy,
  razorpayMultiStoreConfirmHint,
} from '@/lib/multi-store-checkout';
import { postCheckoutPath } from '@/lib/checkout-groups';
import { resolveCheckoutGroupId } from '@/hooks/useCheckoutGroup';
// Store status validation now handled server-side in create_multi_vendor_orders RPC

async function navigateAfterCheckout(
  navigate: ReturnType<typeof useNavigate>,
  orderIds: string[],
) {
  let groupId: string | null = null;
  try {
    groupId = await resolveCheckoutGroupId(orderIds);
  } catch {
    groupId = null;
  }
  const target = postCheckoutPath(orderIds, groupId);
  navigate(target.path, { state: target.state });
}

/** Simple deterministic hash for idempotency keys */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ── Session persistence for unpaid checkout (Preferences + localStorage) ──
// Survives Android process death / WebView purge — not sessionStorage-only.
const PAYMENT_SESSION_KEY = 'sociva_pending_payment_session';
const PAYMENT_SESSION_TTL_MS = 45 * 60 * 1000;

interface PaymentSession {
  orderIds: string[];
  paymentMethod: string;
  amount: number;
  createdAt: number;
  sellerUpiId?: string;
  sellerName?: string;
}

function savePaymentSession(session: PaymentSession) {
  try {
    setString(PAYMENT_SESSION_KEY, JSON.stringify(session));
  } catch {
    try { localStorage.setItem(PAYMENT_SESSION_KEY, JSON.stringify(session)); } catch { /* Persistence is best-effort. */ }
  }
}

function loadPaymentSession(): PaymentSession | null {
  try {
    const raw = getString(PAYMENT_SESSION_KEY) || (() => {
      try { return sessionStorage.getItem(PAYMENT_SESSION_KEY); } catch { return null; }
    })();
    if (!raw) return null;
    const session = JSON.parse(raw) as PaymentSession;
    if (Date.now() - session.createdAt > PAYMENT_SESSION_TTL_MS) {
      clearPaymentSession();
      return null;
    }
    // Migrate legacy sessionStorage-only sessions into durable storage
    try { sessionStorage.removeItem(PAYMENT_SESSION_KEY); } catch { /* Legacy cleanup is best-effort. */ }
    savePaymentSession(session);
    return session;
  } catch { return null; }
}

function clearPaymentSession() {
  try { removeKey(PAYMENT_SESSION_KEY); } catch { /* Cleanup is best-effort. */ }
  try { sessionStorage.removeItem(PAYMENT_SESSION_KEY); } catch { /* Cleanup is best-effort. */ }
  try { localStorage.removeItem(PAYMENT_SESSION_KEY); } catch { /* Cleanup is best-effort. */ }
}

/** Recheck all pending orders — never cancel on a single-order paid race. */
async function anyOrderPaidOrBuyerConfirmed(orderIds: string[]): Promise<boolean> {
  if (orderIds.length === 0) return false;
  const { data } = await supabase
    .from('orders')
    .select('id, payment_status')
    .in('id', orderIds);
  return (data || []).some(
    (o) => o.payment_status === 'paid' || o.payment_status === 'buyer_confirmed',
  );
}

export function useCartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, society } = useAuth();
  const { requestFullPermission } = usePushNotifications();
  const { items, totalAmount, sellerGroups, updateQuantity, removeItem, clearCart, refresh, addItem, isLoading, isFetching, hasHydrated, isRecoveringCart, pendingMutations, cartVerified } = useCart();
  const idempotencyKeyRef = useRef<string | null>(null);

  // RULE 3: Safe route-entry refresh — invalidate only, never overwrite cache
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['cart-items'] });
    queryClient.invalidateQueries({ queryKey: ['cart-count'] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hard reset stale payment state when cart is replaced (reorder flow)
  useEffect(() => {
    const handler = () => {
      clearPaymentSession();
      idempotencyKeyRef.current = null;
    };
    window.addEventListener('cart-replaced', handler);
    return () => window.removeEventListener('cart-replaced', handler);
  }, []);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [showRazorpayCheckout, setShowRazorpayCheckout] = useState(false);
  const razorpaySuccessHandledRef = useRef(false);
  const [showUpiDeepLink, setShowUpiDeepLink] = useState(false);
  const paymentMode = usePaymentMode();
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>([]);
  const pendingOrderIdsRef = useRef<string[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<{ id: string; code: string; discountAmount: number; discount_type?: string; discount_value?: number; max_discount_amount?: number | null; min_order_amount?: number | null } | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<'self_pickup' | 'delivery'>('self_pickup');
  const [orderStep, setOrderStep] = useState<'validating' | 'creating' | 'confirming'>('validating');
  const [selectedDeliveryAddress, setSelectedDeliveryAddress] = useState<any>(null);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [wantsScheduledDelivery, setWantsScheduledDelivery] = useState(false);
  const [paymentFailureInfo, setPaymentFailureInfo] = useState<{ amount: number; sellerName: string } | null>(null);
  const [priceChangeInfo, setPriceChangeInfo] = useState<{ items: string[] } | null>(null);
  const settings = useSystemSettings();
  const { formatPrice, currencySymbol } = useCurrency();
  const { addresses, defaultAddress, isLoading: addressesLoading } = useDeliveryAddresses();
  const loyalty = useLoyaltyRedeem();
  const wallet = useWalletCredit();

  // Keep ref in sync
  useEffect(() => { pendingOrderIdsRef.current = pendingOrderIds; }, [pendingOrderIds]);

  // ── Backend-verified payment session recovery on mount ──
  useEffect(() => {
    const session = loadPaymentSession();
    if (!session || session.orderIds.length === 0) return;

    // Verify backend state before reopening any payment UI
    (async () => {
      try {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, status, payment_status')
          .in('id', session.orderIds);

        if (!orders || orders.length === 0) {
          // Orders don't exist — stale session
          clearPaymentSession();
          return;
        }

        const alreadyPaid = orders.some(
          (o) => o.payment_status === 'paid' || o.payment_status === 'buyer_confirmed',
        );

        if (alreadyPaid) {
          // Payment already processed — navigate to order page, don't reopen payment
          clearPaymentSession();
          const dest = session.orderIds.length === 1 
            ? `/orders/${session.orderIds[0]}` 
            : '/orders';
          navigate(dest);
          return;
        }

        const allCancelled = orders.every(o => o.status === 'cancelled');
        if (allCancelled) {
          // All orders cancelled — stale session
          clearPaymentSession();
          return;
        }

        // Orders are genuinely unpaid and pending — allow resume
        const unpaid = orders.filter(
          (o) => o.status === 'payment_pending' && o.payment_status !== 'paid',
        );
        const unpaidIds = unpaid.map((o) => o.id);

        if (unpaidIds.length === 0) {
          clearPaymentSession();
          return;
        }

        // Phase 1: never resume a multi-store online session — UPI sheet won't mount
        // for N>1, and Razorpay create now rejects multi-seller. Cancel + clear so
        // the buyer is not stuck with invisible payment_pending orders.
        const { data: unpaidWithSellers } = await supabase
          .from('orders')
          .select('id, seller_id')
          .in('id', unpaidIds);
        const sellerIds = new Set(
          (unpaidWithSellers || []).map((o) => o.seller_id).filter(Boolean),
        );
        const isMultiStoreOnlineSession =
          sellerIds.size > 1 ||
          (session.paymentMethod === 'upi' && unpaidIds.length > 1);

        // P5: Razorpay multi-store sessions are valid — reopen checkout.
        // Only clear deep-link UPI multi sessions (cannot pay multiple VPAs).
        if (isMultiStoreOnlineSession && session.paymentMethod !== 'razorpay') {
          try {
            await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: unpaidIds });
          } catch (cancelErr) {
            console.warn('[Recovery] Failed to cancel multi-store pending orders:', cancelErr);
          }
          clearPaymentSession();
          setPendingOrderIds([]);
          toast.message(
            'A previous multi-store UPI payment was cancelled. Checkout one store at a time, or use Cash on Delivery / Pay Online.',
            { id: 'multi-store-session-cleared', duration: 7000 },
          );
          return;
        }

        setPendingOrderIds(unpaidIds);

        if (session.paymentMethod === 'upi') {
          setPaymentMethod('upi');
          setTimeout(() => setShowUpiDeepLink(true), 100);
        } else if (session.paymentMethod === 'razorpay') {
          setPaymentMethod('upi'); // internal state for online payment
          razorpaySuccessHandledRef.current = false;
          // Do not auto-open the modal — the pending-payment banner on the cart
          // page shows "Continue Payment" / "Cancel" so the user decides.
        }
      } catch (err) {
        console.error('[Recovery] Failed to verify payment session:', err);
        // On error, don't blindly reopen — clear stale session
        clearPaymentSession();
      }
    })();
  }, []); // Only on mount

  // Bug 2 fix: Auto-remove coupon when cart drops below min_order_amount
  useEffect(() => {
    if (!appliedCoupon || !appliedCoupon.min_order_amount) return;
    if (totalAmount < appliedCoupon.min_order_amount) {
      setAppliedCoupon(null);
      toast.info(`Coupon "${appliedCoupon.code}" removed — minimum order of ${formatPrice(appliedCoupon.min_order_amount)} not met.`, { id: 'coupon-below-min' });
    }
  }, [totalAmount, appliedCoupon?.min_order_amount]);

  const effectiveCouponDiscount = (() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.discount_type === 'percentage' && appliedCoupon.discount_value) {
      let d = (totalAmount * appliedCoupon.discount_value) / 100;
      if (appliedCoupon.max_discount_amount) d = Math.min(d, appliedCoupon.max_discount_amount);
      return Math.round(d * 100) / 100;
    }
    // Bug 5 fix: Recalculate fixed-amount coupons dynamically (never exceed cart total)
    const fixedValue = appliedCoupon.discount_value ?? appliedCoupon.discountAmount;
    return Math.min(fixedValue, totalAmount);
  })();

  const effectiveDeliveryFee = fulfillmentType === 'delivery' ? (totalAmount >= settings.freeDeliveryThreshold ? 0 : settings.baseDeliveryFee) : 0;
  const amountAfterCoupon = appliedCoupon ? Math.max(0, totalAmount - effectiveCouponDiscount) : totalAmount;
  const effectiveLoyaltyDiscount = Math.min(loyalty.appliedPoints, amountAfterCoupon);
  // Wallet applies after loyalty to remaining payable (includes delivery) — matches server
  const payableBeforeWallet = Math.max(0, amountAfterCoupon - effectiveLoyaltyDiscount) + effectiveDeliveryFee;
  const effectiveWalletCredit = Math.min(wallet.appliedAmount, payableBeforeWallet);
  const finalAmount = Math.max(0, payableBeforeWallet - effectiveWalletCredit);

  const firstSeller = sellerGroups[0]?.items[0]?.product?.seller;
  const firstSellerFulfillmentMode = (firstSeller as any)?.fulfillment_mode as 'self_pickup' | 'seller_delivery' | 'platform_delivery' | 'pickup_and_seller_delivery' | 'pickup_and_platform_delivery' | undefined;
  // Per-seller, per-fulfillment payment resolution
  const resolvedFulfillment = fulfillmentType === 'delivery' ? 'delivery' : 'self_pickup';
  const acceptsCod = sellerGroups.every(g => {
    const s = g.items[0]?.product?.seller as any;
    return resolvePaymentConfig(s, resolvedFulfillment, paymentMode).acceptsCod;
  });
  const acceptsUpi = sellerGroups.every(g => {
    const s = g.items[0]?.product?.seller as any;
    return resolvePaymentConfig(s, resolvedFulfillment, paymentMode).acceptsOnline;
  });
  const onlineDisabledReason = useMemo(() => {
    if (acceptsUpi) return undefined;
    const group = sellerGroups.find(g => {
      const seller = g.items[0]?.product?.seller as any;
      return !resolvePaymentConfig(seller, resolvedFulfillment, paymentMode).acceptsOnline;
    });
    if (!group) return 'Online payment is unavailable for this checkout';
    const seller = group.items[0]?.product?.seller as any;
    const config = resolvedFulfillment === 'delivery'
      ? seller?.delivery_payment_config
      : seller?.pickup_payment_config;
    if (config && config.accepts_online === false) {
      return `${group.sellerName} has disabled online payment for ${resolvedFulfillment === 'delivery' ? 'delivery' : 'pickup'}`;
    }
    if (!paymentMode.isRazorpay) {
      if (!seller?.upi_id || !seller?.accepts_upi) return `${group.sellerName} has not set up direct UPI`;
    }
    return `Online payment is unavailable for ${group.sellerName}`;
  }, [acceptsUpi, sellerGroups, resolvedFulfillment, paymentMode]);
  const hasFulfillmentConflict = sellerGroups.length > 1 && sellerGroups.some(g => {
    const mode = (g.items[0]?.product?.seller as any)?.fulfillment_mode;
    return mode && mode !== 'self_pickup' && !mode.startsWith('pickup_and_') && mode !== fulfillmentType;
  });
  const hasBelowMinimumOrder = sellerGroups.some(g => {
    const minOrder = (g.items[0]?.product?.seller as any)?.minimum_order_amount;
    return minOrder && g.subtotal < minOrder;
  });
  const noPaymentMethodAvailable = !acceptsCod && !acceptsUpi;

  const isMultiSeller = sellerGroups.length > 1;
  const blocksOnlineMultiSeller = requiresSingleSellerForOnline(
    sellerGroups.length,
    paymentMethod,
    { isRazorpay: paymentMode.isRazorpay, isUpiDeepLink: paymentMode.isUpiDeepLink },
  );
  const multiStoreCopy = multiStoreBannerCopy(sellerGroups.length, paymentMethod, {
    isRazorpay: paymentMode.isRazorpay,
    isUpiDeepLink: paymentMode.isUpiDeepLink,
  });
  const multiOrderConfirmHint = razorpayMultiStoreConfirmHint(sellerGroups.length);

  useEffect(() => {
    // Never force online pay on a multi-store cart for deep-link UPI.
    if (isMultiSeller) return;
    if (!acceptsCod && acceptsUpi) setPaymentMethod('upi');
    else if (acceptsCod && !acceptsUpi) setPaymentMethod('cod');
  }, [acceptsCod, acceptsUpi, isMultiSeller]);

  // Deep-link UPI multi-store → prefer COD (cannot split one VPA). Razorpay multi stays online (P5).
  useEffect(() => {
    if (!isMultiSeller) return;
    if (paymentMethod !== 'upi') return;
    if (paymentMode.isRazorpay) return;
    if (!acceptsCod) return;
    setPaymentMethod('cod');
    toast.message('Switched to Cash on Delivery — UPI pays one seller at a time.', {
      id: 'multi-store-switch-cod',
      duration: 5000,
    });
  }, [isMultiSeller, paymentMethod, acceptsCod, paymentMode.isRazorpay]);

  // Track which seller the default was computed for — reset when seller changes
  const defaultFulfillmentSellerId = useRef<string | null>(null);
  useEffect(() => {
    if (sellerGroups.length === 0) return;
    const sellerId = sellerGroups[0]?.sellerId || null;
    // Only compute default once per unique seller (not on every re-render)
    if (defaultFulfillmentSellerId.current === sellerId) return;
    const firstMode = (firstSeller as any)?.fulfillment_mode;
    if (firstMode === 'seller_delivery' || firstMode === 'platform_delivery') setFulfillmentType('delivery');
    else if (firstMode?.startsWith('pickup_and_')) setFulfillmentType('delivery');
    else setFulfillmentType('self_pickup');
    defaultFulfillmentSellerId.current = sellerId;
  }, [sellerGroups.length, firstSeller]);

  // Clear coupon when seller composition changes (multi-vendor or different seller)
  const currentSellerId = sellerGroups.length === 1 ? sellerGroups[0].sellerId : null;
  useEffect(() => {
    if (sellerGroups.length > 1 && appliedCoupon) setAppliedCoupon(null);
  }, [sellerGroups.length]);
  const prevSellerIdRef = useRef(currentSellerId);
  useEffect(() => {
    // Only clear coupon when seller genuinely changes (not on initial mount or same-seller re-derive)
    if (prevSellerIdRef.current && currentSellerId && prevSellerIdRef.current !== currentSellerId && appliedCoupon) {
      setAppliedCoupon(null);
    }
    prevSellerIdRef.current = currentSellerId;
  }, [currentSellerId]);

  // Auto-select default delivery address
  useEffect(() => {
    if (!selectedDeliveryAddress && defaultAddress) {
      setSelectedDeliveryAddress(defaultAddress);
    }
  }, [defaultAddress, selectedDeliveryAddress]);

  const hasUrgentItem = items.some((item) => (item.product as any)?.is_urgent);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const maxPrepTime = items.reduce((max, item) => {
    const pt = (item.product as any)?.prep_time_minutes;
    return pt && pt > max ? pt : max;
  }, 0);

  // Pre-order detection: check if any cart item requires pre-ordering
  const hasPreorderItems = items.some(item => (item.product as any)?.accepts_preorders === true);
  const maxLeadTimeHours = items.reduce((max, item) => {
    const lt = (item.product as any)?.lead_time_hours;
    return (item.product as any)?.accepts_preorders && lt && lt > max ? lt : max;
  }, 0);
  const preorderMissingSchedule = hasPreorderItems && (!scheduledDate || !scheduledTime);

  // Derive cutoff time from pre-order items (use the earliest cutoff across all pre-order products)
  const preorderCutoffTime = useMemo(() => {
    let earliest: string | null = null;
    for (const item of items) {
      const p = item.product as any;
      if (!p?.accepts_preorders) continue;
      const cutoff = p.preorder_cutoff_time;
      if (cutoff && (!earliest || cutoff < earliest)) earliest = cutoff;
    }
    return earliest;
  }, [items]);

  // Track which sellers have pre-order items (for mixed-cart handling - Gap 7)
  const preorderSellerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if ((item.product as any)?.accepts_preorders) {
        ids.add(item.product?.seller_id || '');
      }
    }
    return ids;
  }, [items]);

  const createOrdersForAllSellers = async (paymentStatus: 'pending' | 'paid', transactionRef?: string) => {
    if (!user || !profile || sellerGroups.length === 0) return [];

    const sellerGroupsPayload = sellerGroups.map((group) => ({
      seller_id: group.sellerId, subtotal: group.subtotal,
      items: group.items.map((item) => ({ product_id: item.product_id, product_name: item.product?.name || 'Unknown', quantity: item.quantity, unit_price: item.product?.price || 0 })),
    }));

    // Price + availability validation is now handled server-side in the RPC

    const deliveryAddressText = fulfillmentType === 'delivery' && selectedDeliveryAddress
      ? [selectedDeliveryAddress.flat_number && `Flat ${selectedDeliveryAddress.flat_number}`, selectedDeliveryAddress.block && `Block ${selectedDeliveryAddress.block}`, selectedDeliveryAddress.building_name, selectedDeliveryAddress.landmark].filter(Boolean).join(', ')
      : [profile.block && `Block ${profile.block}`, profile.flat_number].filter(Boolean).join(', ') || profile?.name || 'Self Pickup';

    // Generate idempotency key if not already set for this attempt
    if (!idempotencyKeyRef.current) {
      const cartHash = items.map(i => `${i.product_id}:${i.quantity}`).sort().join('|');
      idempotencyKeyRef.current = `${user.id}_${Date.now()}_${simpleHash(cartHash)}`;
    }

    // Bug 2 fix: Use 'card' for Razorpay payments instead of misleading 'upi'
    const effectivePaymentMethod = paymentMode.isRazorpay && paymentMethod === 'upi' ? 'online' : paymentMethod;
    // Format scheduled date/time for pre-order items
    const scheduledDateStr = scheduledDate ? scheduledDate.toISOString().split('T')[0] : null;
    const scheduledTimeStr = scheduledTime ? `${scheduledTime}:00` : null;
    const { data, error } = await supabase.rpc('create_multi_vendor_orders', {
      _buyer_id: user.id, _delivery_address: deliveryAddressText,
      _notes: notes || null, _payment_method: effectivePaymentMethod, _payment_status: paymentStatus,
      _coupon_id: appliedCoupon?.id || null,
      _coupon_discount: effectiveCouponDiscount,
      _seller_groups: sellerGroupsPayload, _fulfillment_type: fulfillmentType, _delivery_fee: effectiveDeliveryFee,
      _delivery_address_id: selectedDeliveryAddress?.id || null,
      _delivery_lat: selectedDeliveryAddress?.latitude || null,
      _delivery_lng: selectedDeliveryAddress?.longitude || null,
      _idempotency_key: idempotencyKeyRef.current,
      _scheduled_date: scheduledDateStr,
      _scheduled_time_start: scheduledTimeStr,
      _preorder_seller_ids: preorderSellerIds.size > 0 ? Array.from(preorderSellerIds) : null,
      // Platform-funded loyalty: server reserves/allocates/commits (COD) — never trust client math alone
      _loyalty_points: effectiveLoyaltyDiscount > 0 ? Math.floor(effectiveLoyaltyDiscount) : 0,
      // Sociva Credit: after loyalty; server promo-first FIFO + reserve/commit
      _wallet_amount: effectiveWalletCredit > 0 ? Math.round(effectiveWalletCredit * 100) / 100 : 0,
    } as any);
    if (error) {
      // Do NOT reset idempotency key — retry must use the same key
      // so the DB advisory lock + dedup check can detect the duplicate.
      // Key is only reset on confirmed success or business-logic rejection.
      throw error;
    }

    const result = data as {
      success: boolean;
      order_ids?: string[];
      order_count?: number;
      error?: string;
      message?: string;
      items?: string[];
      sellers?: string[];
      unavailable_items?: string[];
      price_changed_items?: string[];
      stock_insufficient?: string[];
      closed_sellers?: string[];
      out_of_range_sellers?: string[];
      deduplicated?: boolean;
    };
    if (!result?.success) {
      idempotencyKeyRef.current = null;
      const itemList = result?.unavailable_items || result?.items;
      const priceList = result?.price_changed_items || result?.items;
      const stockList = result?.stock_insufficient || result?.items;
      const closedList = result?.closed_sellers || result?.sellers;
      const oorList = result?.out_of_range_sellers || result?.sellers;

      if (result?.error === 'unavailable_items' && itemList?.length) {
        await refresh();
        throw new Error(`Some items are unavailable:\n• ${itemList.join('\n• ')}`);
      }
      if (result?.error === 'price_changed' && priceList?.length) {
        await refresh();
        throw new Error(`Prices have changed:\n• ${priceList.join('\n• ')}\nYour cart has been refreshed.`);
      }
      if (result?.error === 'insufficient_stock' && stockList?.length) {
        await refresh();
        throw new Error(`Insufficient stock:\n• ${stockList.join('\n• ')}`);
      }
      if (result?.error === 'stock_validation_failed' && itemList?.length) {
        throw new Error(`Some items are unavailable:\n• ${itemList.join('\n• ')}`);
      }
      if (result?.error === 'non_cart_items' && itemList?.length) {
        throw new Error(`Some items cannot be ordered via cart:\n• ${itemList.join('\n• ')}`);
      }
      if (result?.error === 'store_closed' || result?.error === 'sellers_closed') {
        throw new Error(closedList?.length ? `Store closed: ${closedList.join(', ')}` : 'Store is currently closed. Please try again later.');
      }
      if (result?.error === 'delivery_out_of_range' || result?.error === 'out_of_range') {
        throw new Error(oorList?.length ? `Delivery not possible:\n• ${oorList.join('\n• ')}` : 'Delivery address is out of range for one or more sellers.');
      }
      if (result?.error === 'payment_method_not_accepted') {
        const blocked = result.sellers || [];
        throw new Error(result.message || (blocked.length
          ? `Selected payment method is not accepted by: ${blocked.join(', ')}`
          : 'Selected payment method is not accepted by this seller.'));
      }
      if (result?.error === 'unauthorized') {
        throw new Error('Your session has expired. Please log in again.');
      }
      throw new Error(result?.message || result?.error || 'Failed to create orders');
    }
    // Reset idempotency key after successful (non-deduplicated) creation
    if (!result.deduplicated) idempotencyKeyRef.current = null;
    return result.order_ids || [];
  };

  /** Force-clear cart from both DB and query cache */
  const clearCartAndCache = useCallback(async () => {
    await clearCart();
    if (user) {
      queryClient.setQueryData(['cart-items', user.id], []);
      queryClient.setQueryData(['cart-count', user.id], 0);
    }
  }, [clearCart, queryClient, user]);

  /** Prefetch status flow + transitions so order detail page loads instantly */
  const prefetchFlowData = useCallback(() => {
    try {
      const seller = sellerGroups[0]?.items[0]?.product?.seller as any;
      const parentGroup = seller?.primary_group || 'default';
      const ft = fulfillmentType === 'delivery' ? (seller?.fulfillment_mode === 'platform_delivery' ? 'delivery' : 'seller_delivery') : 'self_pickup';
      const dhb = fulfillmentType === 'delivery' ? (seller?.fulfillment_mode === 'platform_delivery' ? 'platform' : 'seller') : null;
      const txnType = resolveTransactionType(parentGroup, 'purchase', ft, dhb);

      queryClient.prefetchQuery({
        queryKey: statusFlowQueryKey(parentGroup, txnType),
        queryFn: () => fetchStatusFlow(parentGroup, txnType),
        staleTime: 5 * 60 * 1000,
      });
      queryClient.prefetchQuery({
        queryKey: statusTransitionsQueryKey(parentGroup, txnType),
        queryFn: () => fetchStatusTransitions(parentGroup, txnType),
        staleTime: 5 * 60 * 1000,
      });
    } catch { /* best-effort prefetch */ }
  }, [sellerGroups, fulfillmentType, queryClient]);

  const handlePlaceOrderInner = async () => {
    if (!user || !profile || sellerGroups.length === 0) return;

    // GUARD: Check for existing pending unpaid orders to prevent duplicates
    const existingSession = loadPaymentSession();
    const pendingIds = pendingOrderIdsRef.current.length > 0 ? pendingOrderIdsRef.current : (existingSession?.orderIds || []);

    if (pendingIds.length > 0) {
      const { data: existingOrders } = await supabase
        .from('orders')
        .select('id, status, payment_status')
        .in('id', pendingIds)
        .eq('buyer_id', user.id);

      const stillPending = existingOrders?.filter(o => o.status !== 'cancelled' && o.payment_status !== 'paid' && o.payment_status !== 'buyer_confirmed') as any[];
      if (stillPending && stillPending.length > 0) {
        const continuePayment = await notify.confirm(
          'An earlier payment is still pending. Continue that payment, or cancel it before creating another order.',
          {
          id: 'checkout-pending',
            title: 'Payment already in progress',
            okLabel: 'Continue payment',
            cancelLabel: 'Cancel pending payment',
            priority: 'critical',
          },
        );
        if (!continuePayment) {
          try {
            const { error: cancelErr } = await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: stillPending.map((o: any) => o.id) });
            if (cancelErr) throw cancelErr;
            setPendingOrderIds([]);
            clearPaymentSession();
            notify.success('Pending payment cancelled', { id: 'checkout-pending-cancelled' });
          } catch (err) {
            console.error('Failed to cancel pending orders:', err);
            notify.error(err, { id: 'checkout-pending-cancel-error', title: 'Could not cancel the pending payment. Please try again.' });
          }
          return;
        }
        // Re-open the correct payment UI
        setPendingOrderIds(stillPending.map(o => o.id));
        if (paymentMethod === 'upi' && paymentMode.isUpiDeepLink) {
          setShowUpiDeepLink(true);
        } else if (paymentMode.isRazorpay) {
          razorpaySuccessHandledRef.current = false;
          setShowRazorpayCheckout(true);
        }
        return;
      }
      // All pending orders were cancelled or paid — clear session
      setPendingOrderIds([]);
      clearPaymentSession();
    }

    const selfSellerGroup = sellerGroups.find(g => { const sellerUserId = (g.items[0]?.product?.seller as any)?.user_id; return sellerUserId && sellerUserId === user.id; });
    if (selfSellerGroup) { notify.block("You cannot place an order from your own store."); return; }
    if (!navigator.onLine) { toast.error("You're offline. Please check your connection and try again.", { id: 'checkout-offline' }); return; }
    if (fulfillmentType === 'delivery' && !selectedDeliveryAddress) { notify.block('Please add a delivery address to continue.'); return; }
    if (fulfillmentType === 'delivery' && selectedDeliveryAddress && !selectedDeliveryAddress.latitude) { notify.block('Your selected address has no location coordinates. Please update it with a precise location.'); return; }

    // GUARD: Pre-order items MUST have a scheduled date/time — cannot bypass via race condition
    if (hasPreorderItems && (!scheduledDate || !scheduledTime)) {
      notify.block('Please select a delivery date & time for pre-order items.');
      return;
    }

    // GUARD: Server-side fulfillment validation — prevent sending self_pickup when seller only does delivery (and vice versa)
    for (const group of sellerGroups) {
      const sellerMode = (group.items[0]?.product?.seller as any)?.fulfillment_mode;
      if (sellerMode) {
        const sellerSupportsPickup = sellerMode === 'self_pickup' || sellerMode.startsWith('pickup_and_');
        const sellerSupportsDelivery = sellerMode !== 'self_pickup';
        if (fulfillmentType === 'self_pickup' && !sellerSupportsPickup) {
          setFulfillmentType('delivery');
          notify.info(`${group.sellerName} only supports delivery. Your checkout has been switched to delivery.`, { id: 'checkout-fulfillment-mismatch', title: 'Delivery selected' });
          return;
        }
        if (fulfillmentType === 'delivery' && !sellerSupportsDelivery) {
          setFulfillmentType('self_pickup');
          notify.info(`${group.sellerName} only supports self-pickup. Your checkout has been switched to pickup.`, { id: 'checkout-fulfillment-mismatch', title: 'Pickup selected' });
          return;
        }
      }
    }

    // Daily order limit enforcement
    for (const group of sellerGroups) {
      const dailyLimit = (group.items[0]?.product?.seller as any)?.daily_order_limit;
      if (dailyLimit && dailyLimit > 0) {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);
        const todayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffset).toISOString();
        const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('seller_id', group.sellerId).gte('created_at', todayStart).not('status', 'in', '("cancelled","payment_pending")');
        if ((count || 0) >= dailyLimit) {
          notify.block(`${group.sellerName} has reached today’s order limit. Please try again tomorrow or remove this store from the cart.`, { id: `checkout-daily-limit:${group.sellerId}`, title: 'Store cannot accept more orders' });
          return;
        }
      }
    }

    for (const group of sellerGroups) {
      const minOrder = (group.items[0]?.product?.seller as any)?.minimum_order_amount;
      if (minOrder && group.subtotal < minOrder) { notify.block(`Add ${formatPrice(minOrder - group.subtotal)} more from ${group.sellerName} to reach its ${formatPrice(minOrder)} minimum.`, { id: `checkout-min-order:${group.sellerId}`, title: 'Minimum order not reached' }); return; }
    }

    setPriceChangeInfo(null);
    setPaymentFailureInfo(null);
    setIsPlacingOrder(true);
    hapticImpact('medium');

    // All product availability, price, store status, and delivery range checks
    // are now handled server-side in the RPC for atomicity and speed.

    if (paymentMethod === 'cod' && !acceptsCod) { notify.block('Cash on Delivery is unavailable for one or more stores. Choose Pay Online or remove those stores.', { id: 'checkout-no-cod', title: 'Payment method unavailable' }); setIsPlacingOrder(false); return; }

    // Full Sociva Credit (+loyalty) cover: no gateway residual.
    // payment_method=wallet → CMVO commits holds + marks payment_status=paid (SECURITY DEFINER).
    // Do NOT client-update payment_status — trg_guard_order_payment_status blocks authenticated.
    if (finalAmount <= 0 && effectiveWalletCredit > 0) {
      try {
        const sellerGroupsPayload = sellerGroups.map((group) => ({
          seller_id: group.sellerId, subtotal: group.subtotal,
          items: group.items.map((item) => ({
            product_id: item.product_id,
            product_name: item.product?.name || 'Unknown',
            quantity: item.quantity,
            unit_price: item.product?.price || 0,
          })),
        }));
        const deliveryAddressText = fulfillmentType === 'delivery' && selectedDeliveryAddress
          ? [selectedDeliveryAddress.flat_number && `Flat ${selectedDeliveryAddress.flat_number}`, selectedDeliveryAddress.block && `Block ${selectedDeliveryAddress.block}`, selectedDeliveryAddress.building_name, selectedDeliveryAddress.landmark].filter(Boolean).join(', ')
          : [profile.block && `Block ${profile.block}`, profile.flat_number].filter(Boolean).join(', ') || profile?.name || 'Self Pickup';
        if (!idempotencyKeyRef.current) {
          const cartHash = items.map(i => `${i.product_id}:${i.quantity}`).sort().join('|');
          idempotencyKeyRef.current = `${user.id}_${Date.now()}_${simpleHash(cartHash)}`;
        }
        const scheduledDateStr = scheduledDate ? scheduledDate.toISOString().split('T')[0] : null;
        const scheduledTimeStr = scheduledTime ? `${scheduledTime}:00` : null;
        const { data, error } = await supabase.rpc('create_multi_vendor_orders', {
          _buyer_id: user.id,
          _delivery_address: deliveryAddressText,
          _notes: notes || null,
          _payment_method: 'wallet',
          _payment_status: 'pending',
          _coupon_id: appliedCoupon?.id || null,
          _coupon_discount: effectiveCouponDiscount,
          _seller_groups: sellerGroupsPayload,
          _fulfillment_type: fulfillmentType,
          _delivery_fee: effectiveDeliveryFee,
          _delivery_address_id: selectedDeliveryAddress?.id || null,
          _delivery_lat: selectedDeliveryAddress?.latitude || null,
          _delivery_lng: selectedDeliveryAddress?.longitude || null,
          _idempotency_key: idempotencyKeyRef.current,
          _scheduled_date: scheduledDateStr,
          _scheduled_time_start: scheduledTimeStr,
          _preorder_seller_ids: preorderSellerIds.size > 0 ? Array.from(preorderSellerIds) : null,
          _loyalty_points: effectiveLoyaltyDiscount > 0 ? Math.floor(effectiveLoyaltyDiscount) : 0,
          _wallet_amount: Math.round(effectiveWalletCredit * 100) / 100,
        } as any);
        if (error) throw error;
        const result = data as { success?: boolean; order_ids?: string[]; error?: string };
        if (!result?.success || !result.order_ids?.length) {
          throw new Error((result as any)?.message || result?.error || 'Failed to create orders');
        }
        const orderIds = result.order_ids;

        hapticNotification('success');
        prefetchFlowData();
        loyalty.clearAppliedPoints();
        wallet.clearApplied();
        queryClient.invalidateQueries({ queryKey: ['loyalty-balance'] });
        queryClient.invalidateQueries({ queryKey: ['buyer-wallet'] });
        queryClient.invalidateQueries({ queryKey: ['wallet-history'] });
        queryClient.setQueryData(['cart-items', user.id], []);
        queryClient.setQueryData(['cart-count', user.id], 0);
        await navigateAfterCheckout(navigate, orderIds);
        clearCartAndCache().catch(() => {});
        requestFullPermission().catch(() => {});
        supabase.functions.invoke('process-notification-queue').catch(() => {});
      } catch (error: any) {
        console.error('Error placing wallet-only order:', error);
        // Extract actual RPC error message instead of letting friendlyError sanitize it
        const rawMessage = error?.message ?? error?.details ?? error?.hint ?? String(error);
        const isTechnical = rawMessage.startsWith('{') || rawMessage.includes('rpc') || rawMessage.includes('P0001');
        const displayMessage = isTechnical ? friendlyError(error) : rawMessage;
        notify.error(displayMessage, { id: 'checkout-wallet-error' });
      } finally {
        setIsPlacingOrder(false);
      }
      return;
    }

    if (paymentMethod === 'upi') {
      if (!acceptsUpi) {
        const unmetPayout = sellerGroups.some(g => {
          const s = g.items[0]?.product?.seller as any;
          return !s?.upi_id;
        });
        notify.block(
          unmetPayout
            ? 'This seller has not set up a UPI account. Choose Cash on Delivery or another store.'
            : 'Online payment not available',
          { id: unmetPayout ? 'upi-payout-not-ready' : 'upi-unavailable', title: 'Payment method unavailable' },
        );
        setIsPlacingOrder(false);
        return;
      }
      // P5: Razorpay multi-seller unlocked; deep-link UPI still single-seller
      if (requiresSingleSellerForOnline(sellerGroups.length, paymentMethod, {
        isRazorpay: paymentMode.isRazorpay,
        isUpiDeepLink: paymentMode.isUpiDeepLink,
      })) {
        notify.block(onlineMultiSellerBlockedMessage(paymentMode.isRazorpay), {
          id: 'online-multi-seller-blocked',
          title: 'Checkout stores separately',
        });
        setIsPlacingOrder(false);
        return;
      }
      // Defense in depth: deep-link UPI is always single-VPA
      if (paymentMode.isUpiDeepLink && sellerGroups.length > 1) {
        notify.block(
          'UPI pay works for one seller at a time. Remove other sellers’ items, or pay online (Razorpay) / COD.',
          { id: 'upi-multi-seller-blocked', title: 'UPI cannot split this payment' },
        );
        setIsPlacingOrder(false);
        return;
      }
      if (!paymentMode.isRazorpay) {
        for (const group of sellerGroups) {
          const seller = group.items[0]?.product?.seller as any;
          if (!seller?.upi_id) {
            notify.block('This seller has not set up a UPI account. Choose Cash on Delivery or another store.', { id: `upi-payout-not-ready:${group.sellerId}`, title: 'Seller UPI unavailable' });
            setIsPlacingOrder(false);
            return;
          }
        }
      }
      setOrderStep('creating');
      try {
        const orderIds = await createOrdersForAllSellers('pending');
        if (orderIds.length === 0) throw new Error('Failed to create orders');
        setPendingOrderIds(orderIds);
        // CRITICAL: Persist payment session so it survives app-switch / process death
        const sellerForSession = sellerGroups[0]?.items[0]?.product?.seller as any;
        savePaymentSession({
          orderIds,
          paymentMethod: paymentMode.isRazorpay ? 'razorpay' : 'upi',
          amount: finalAmount,
          createdAt: Date.now(),
          sellerUpiId: sellerForSession?.upi_id || undefined,
          sellerName: sellerGroups[0]?.sellerName || undefined,
        });
        // Do NOT clear cart — cart stays until payment is confirmed (Razorpay)
        // or buyer claims UPI (then we clear).
        upiCompletionRef.current = false; // Reset guard for new payment session
        if (paymentMode.isUpiDeepLink) {
          setShowUpiDeepLink(true);
        } else {
          razorpaySuccessHandledRef.current = false;
          setShowRazorpayCheckout(true);
        }
      } catch (error: any) {
        console.error('Error creating orders:', error);
        // Extract actual RPC error message instead of letting friendlyError sanitize it
        const rawMessage = error?.message ?? error?.details ?? error?.hint ?? String(error);
        const isTechnical = rawMessage.startsWith('{') || rawMessage.includes('rpc') || rawMessage.includes('P0001');
        const displayMessage = isTechnical ? friendlyError(error) : rawMessage;
        notify.error(displayMessage, { id: 'checkout-create-error' });
      }
      finally { setIsPlacingOrder(false); }
      return;
    }

    // COD flow — order is confirmed immediately, no overlay needed
    try {
      const orderIds = await createOrdersForAllSellers('pending');
      if (orderIds.length === 0) throw new Error('Failed to create orders');
      hapticNotification('success');
      prefetchFlowData();
      // Loyalty + wallet already reserved+committed server-side for COD inside create_multi_vendor_orders
      if (effectiveLoyaltyDiscount > 0) {
        loyalty.clearAppliedPoints();
        queryClient.invalidateQueries({ queryKey: ['loyalty-balance'] });
        queryClient.invalidateQueries({ queryKey: ['loyalty-history'] });
      }
      if (effectiveWalletCredit > 0) {
        wallet.clearApplied();
        queryClient.invalidateQueries({ queryKey: ['buyer-wallet'] });
        queryClient.invalidateQueries({ queryKey: ['wallet-history'] });
      }
      // Optimistically clear cart cache BEFORE navigation to prevent back-button duplicates
      queryClient.setQueryData(['cart-items', user.id], []);
      queryClient.setQueryData(['cart-count', user.id], 0);
      await navigateAfterCheckout(navigate, orderIds);
      // Background: DB cleanup + trigger notifications (non-blocking)
      clearCartAndCache().catch(() => {});
      requestFullPermission().catch(() => {});
      supabase.functions.invoke('process-notification-queue').catch(() => {});
    } catch (error: any) {
      console.error('Error placing COD order:', error);
      // Extract actual RPC error message instead of letting friendlyError sanitize it
      const rawMessage = error?.message ?? error?.details ?? error?.hint ?? String(error);
      const isTechnical = rawMessage.startsWith('{') || rawMessage.includes('rpc') || rawMessage.includes('P0001');
      const displayMessage = isTechnical ? friendlyError(error) : rawMessage;
      notify.error(displayMessage, { id: 'checkout-error' });
    }
    finally { setIsPlacingOrder(false); }
  };

  const handlePlaceOrder = useSubmitGuard(handlePlaceOrderInner, 3000, 0);

  const handleRazorpaySuccess = async (paymentId: string) => {
    // Double-invocation guard — Razorpay SDK can fire success twice in rare cases
    if (razorpaySuccessHandledRef.current) return;
    razorpaySuccessHandledRef.current = true;

    setShowRazorpayCheckout(false);
    const orderIds = [...pendingOrderIds];

    // Empty orderIds guard — fallback to orders list
    if (!orderIds.length) {
      navigate('/orders');
      return;
    }

    // Instant overlay — user sees "Confirming payment…" immediately
    setIsPlacingOrder(true);
    setOrderStep('confirming');

    // CRITICAL: Call backend to verify payment with Razorpay API and advance order state
    // This is the PRIMARY confirmation path — webhook is now just a fallback
    // Retrieve razorpay_order_id from orders for reconciliation
    let razorpayOrderId: string | null = null;
    try {
      const { data: orderRow } = await supabase
        .from('orders')
        .select('razorpay_order_id')
        .eq('id', orderIds[0])
        .single();
      razorpayOrderId = orderRow?.razorpay_order_id || null;
    } catch { /* best effort */ }

    console.log(`[Payment][client_confirm] order_ids=${orderIds.join(',')}, razorpay_payment_id=${paymentId}, razorpay_order_id=${razorpayOrderId}`);

    let confirmOk = false;
    try {
      const { data: confirmData, error: confirmErr } = await supabase.functions.invoke('confirm-razorpay-payment', {
        body: {
          razorpay_payment_id: paymentId,
          razorpay_order_id: razorpayOrderId,
          order_ids: orderIds,
        },
      });
      if (confirmErr) {
        console.warn('[Payment][client_confirm] result=failed', confirmErr);
      } else if (confirmData?.success === false) {
        console.warn('[Payment][client_confirm] result=rejected', confirmData);
      } else {
        confirmOk = true;
        console.log('[Payment][client_confirm] result=success');
      }
    } catch (err) {
      console.warn('[Payment][client_confirm] result=call_failed, webhook fallback:', err);
    }

    // Navigate on next animation frame (deterministic, no magic delays)
    await new Promise(r => requestAnimationFrame(r));
    await navigateAfterCheckout(navigate, orderIds);

    // Cleanup AFTER navigation — never claim success or clear cart unless confirm OK
    setTimeout(() => {
      if (confirmOk) {
        clearPaymentSession();
        // Loyalty + wallet commit happens in confirm-razorpay-payment (server-authoritative)
        if (effectiveLoyaltyDiscount > 0) {
          loyalty.clearAppliedPoints();
          queryClient.invalidateQueries({ queryKey: ['loyalty-balance'] });
          queryClient.invalidateQueries({ queryKey: ['loyalty-history'] });
        }
        if (effectiveWalletCredit > 0) {
          wallet.clearApplied();
          queryClient.invalidateQueries({ queryKey: ['buyer-wallet'] });
          queryClient.invalidateQueries({ queryKey: ['wallet-history'] });
        }
        setPendingOrderIds([]);
        clearCartAndCache().catch(() => {});
      } else {
        notify.warn(
          'Payment received but confirmation is still pending. Check Orders — do not pay again until status updates.',
          { id: 'razorpay-pending', title: 'Do not pay again', priority: 'critical', okLabel: 'View order status' },
        );
        // Keep pending session so buyer can retry confirm / see payment_pending orders
        setPendingOrderIds(orderIds);
      }
      setIsPlacingOrder(false);
    }, 0);
  };

  const handleRazorpayFailed = async () => {
    // If success already handled, never cancel orders
    if (razorpaySuccessHandledRef.current) {
      console.log('[Payment] handleRazorpayFailed suppressed — success already handled');
      setShowRazorpayCheckout(false);
      return;
    }
    setShowRazorpayCheckout(false);

    if (pendingOrderIds.length > 0) {
      // Single check — covers webhook confirming while modal was open
      if (await anyOrderPaidOrBuyerConfirmed(pendingOrderIds)) {
        await clearCartAndCache();
        clearPaymentSession();
        navigate(pendingOrderIds.length === 1 ? `/orders/${pendingOrderIds[0]}` : '/orders');
        setPendingOrderIds([]);
        return;
      }
      // Not paid — cancel immediately so no payment_pending orders linger
      try {
        await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: pendingOrderIds });
      } catch (err) {
        console.warn('[Payment] failed: cancel pending orders failed (non-blocking):', err);
      }
    }

    setPendingOrderIds([]);
    clearPaymentSession();
    idempotencyKeyRef.current = null;
    toast.info('Payment failed. Your cart is saved — tap Place Order to try again.', {
      id: 'razorpay-failed',
      duration: 4000,
    });
  };

  // Dismiss handler — single check, cancel if unpaid, return to cart cleanly
  const handleRazorpayDismiss = async () => {
    if (razorpaySuccessHandledRef.current) {
      console.log('[Payment] handleRazorpayDismiss suppressed — success already handled');
      setShowRazorpayCheckout(false);
      return;
    }
    setShowRazorpayCheckout(false);

    if (pendingOrderIds.length > 0) {
      // Single immediate check — covers the case where webhook confirmed while modal was open
      if (await anyOrderPaidOrBuyerConfirmed(pendingOrderIds)) {
        await clearCartAndCache();
        clearPaymentSession();
        navigate(pendingOrderIds.length === 1 ? `/orders/${pendingOrderIds[0]}` : '/orders');
        setPendingOrderIds([]);
        return;
      }
      // Not paid — cancel pending orders so the user returns to a clean cart.
      // buyer_cancel_pending_orders is safe: it only cancels payment_pending orders,
      // so a webhook-confirmed paid order is never touched.
      try {
        await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: pendingOrderIds });
      } catch (err) {
        console.warn('[Payment] dismiss: cancel pending orders failed (non-blocking):', err);
      }
    }

    setPendingOrderIds([]);
    clearPaymentSession();
    idempotencyKeyRef.current = null;
    toast.info('Payment cancelled. Your cart is saved — tap Place Order to try again.', {
      id: 'razorpay-dismiss',
      duration: 4000,
    });
  };

  // ── UPI completion guard: only ONE of success/failed can execute per session ──
  const upiCompletionRef = useRef(false);

  const handleUpiDeepLinkSuccess = async () => {
    if (upiCompletionRef.current) return;
    upiCompletionRef.current = true;
    setShowUpiDeepLink(false);

    // Buyer self-attest only — order stays payment_pending/buyer_confirmed until seller verifies.
    clearPaymentSession();
    const dest = pendingOrderIds.length === 1 ? `/orders/${pendingOrderIds[0]}` : '/orders';
    setPendingOrderIds([]);
    // Clear cart so buyer cannot place a duplicate while awaiting seller verify
    try { await clearCartAndCache(); } catch { /* best-effort */ }
    navigate(dest);
    supabase.functions.invoke('process-notification-queue').catch(() => {});
  };

  const handleUpiDeepLinkFailed = async (explicitCancel?: boolean) => {
    if (upiCompletionRef.current) return;
    upiCompletionRef.current = true;
    setShowUpiDeepLink(false);
    if (!user?.id) { notify.block('Your session expired. Sign in again before continuing.', { id: 'checkout-session', title: 'Sign in required' }); setPendingOrderIds([]); clearPaymentSession(); return; }
    if (pendingOrderIds.length > 0) {
      if (await anyOrderPaidOrBuyerConfirmed(pendingOrderIds)) {
        toast.message('Payment already submitted — waiting for seller confirmation', { id: 'upi-awaiting-seller' });
        clearPaymentSession();
        try { await clearCartAndCache(); } catch { /* best-effort */ }
        navigate(pendingOrderIds.length === 1 ? `/orders/${pendingOrderIds[0]}` : '/orders');
        setPendingOrderIds([]);
        return;
      }
      // Explicit user cancel: hard-cancel the orders in DB immediately
      if (explicitCancel) {
        try {
          await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: pendingOrderIds });
        } catch (err) {
          console.warn('[UPI] explicit cancel: failed to cancel pending orders:', err);
        }
        setPendingOrderIds([]);
        clearPaymentSession();
        toast.info('Payment cancelled. Your cart is saved.', { id: 'upi-cancelled', duration: 3000 });
        return;
      }
      // Non-explicit (app-switch, timeout, dismiss): do not auto-cancel — buyer may have paid in UPI app; server TTL cleans unpaid.
      notify.warn(
        'UPI not confirmed yet. Finish payment from Orders, or cancel unpaid there. Do not pay twice.',
        { id: 'upi-failed-hold', title: 'UPI payment not confirmed', priority: 'critical', okLabel: 'View orders' },
      );
      navigate(pendingOrderIds.length === 1 ? `/orders/${pendingOrderIds[0]}` : '/orders');
      return;
    }
    setPendingOrderIds([]);
    clearPaymentSession();
    setPaymentFailureInfo({
      amount: finalAmount || sessionAmount || 0,
      sellerName: sellerGroups[0]?.sellerName || sessionSellerName || 'Seller',
    });
  };

  // Compute whether we have an active payment session (for rendering payment UI even if cart is empty)
  const activeSession = loadPaymentSession();
  const hasActivePaymentSession = pendingOrderIds.length > 0 || !!activeSession;
  // Fallback seller details from session for app-resume when cart is empty
  const sessionSellerUpiId = activeSession?.sellerUpiId || '';
  const sessionSellerName = activeSession?.sellerName || 'Seller';
  const sessionAmount = activeSession?.amount || 0;

  // Bug 9 fix: Cancel orders in DB before clearing local state
  const clearPendingPayment = useCallback(async () => {
    const ids = pendingOrderIdsRef.current;
    if (ids.length > 0) {
      try {
        await supabase.rpc('buyer_cancel_pending_orders', { _order_ids: ids });
      } catch (err) {
        console.error('Failed to cancel pending orders:', err);
        notify.error(err, { id: 'clear-pending-fail', title: 'Could not cancel the pending order. Please try again.' });
        return; // Don't clear local state if DB cancel failed
      }
    }
    setPendingOrderIds([]);
    clearPaymentSession();
    idempotencyKeyRef.current = null;
  }, []);

  const retryPendingPayment = useCallback(async () => {
    // Backend-verify before reopening payment UI
    const ids = pendingOrderIdsRef.current;
    if (ids.length > 0) {
      try {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, status, payment_status')
          .in('id', ids);

        const alreadyPaid = orders?.some(o =>
          o.payment_status === 'paid' ||
          o.payment_status === 'buyer_confirmed' ||
          (o.status !== 'payment_pending' && o.status !== 'cancelled')
        );

        if (alreadyPaid) {
          clearPaymentSession();
          setPendingOrderIds([]);
          const dest = ids.length === 1 ? `/orders/${ids[0]}` : '/orders';
          navigate(dest);
          return;
        }
      } catch (err) {
        console.error('[Retry] Failed to verify order status:', err);
      }
    }

    if (paymentMode.isRazorpay) {
      razorpaySuccessHandledRef.current = false;
      setShowRazorpayCheckout(true);
    } else if (paymentMode.isUpiDeepLink) {
      setShowUpiDeepLink(true);
    }
  }, [paymentMode, navigate]);

  const retryPaymentAfterFailure = async () => {
    setPaymentFailureInfo(null);
    await handlePlaceOrderInner();
  };

  const dismissPriceChangeInfo = () => setPriceChangeInfo(null);

  const continueWithUpdatedPrices = async () => {
    setPriceChangeInfo(null);
    setShowConfirmDialog(false);
    await handlePlaceOrderInner();
  };

  /** Keep only one seller's items — useful for deep-link UPI or split checkout. */
  const checkoutThisStoreOnly = useCallback(async (sellerId: string) => {
    const group = sellerGroups.find((g) => g.sellerId === sellerId);
    if (!group) return;
    // Prefer group membership over product.seller_id (avoids 'unknown' / stale joins)
    const keepIds = new Set(group.items.map((i) => i.product_id));
    const others = items.filter((i) => !keepIds.has(i.product_id));
    if (others.length === 0) {
      toast.message('Cart already has only this store.', { id: 'checkout-this-store' });
      return;
    }
    for (const item of others) {
      await removeItem(item.product_id);
    }
    toast.success(`Ready to checkout ${group.sellerName} only. Other stores removed from cart.`, {
      id: 'checkout-this-store',
      duration: 5000,
    });
    hapticSelection();
  }, [sellerGroups, items, removeItem]);

  return {
    user, profile, society, items, totalAmount, sellerGroups, updateQuantity, removeItem, clearCart, addItem, isLoading, isFetching, hasHydrated, isRecoveringCart, pendingMutations, cartVerified,
    notes, setNotes, paymentMethod, setPaymentMethod,
    isPlacingOrder, showRazorpayCheckout, showUpiDeepLink, setShowUpiDeepLink, pendingOrderIds, paymentMode,
    appliedCoupon, setAppliedCoupon, showConfirmDialog, setShowConfirmDialog,
    fulfillmentType, setFulfillmentType, orderStep,
    settings, formatPrice, currencySymbol,
    effectiveDeliveryFee, finalAmount, acceptsCod, acceptsUpi, onlineDisabledReason,
    hasUrgentItem, itemCount, maxPrepTime,
    effectiveCouponDiscount, effectiveLoyaltyDiscount, loyalty,
    effectiveWalletCredit, payableBeforeWallet, wallet,
    firstSellerFulfillmentMode,
    hasFulfillmentConflict, hasBelowMinimumOrder, noPaymentMethodAvailable,
    isMultiSeller, blocksOnlineMultiSeller, multiStoreCopy, multiOrderConfirmHint,
    /** Multi-store cart with no COD and online blocked (deep-link) — must split */
    multiStoreRequiresSplit: isMultiSeller && !acceptsCod && blocksOnlineMultiSeller,
    checkoutThisStoreOnly,
    selectedDeliveryAddress, setSelectedDeliveryAddress, addresses, addressesLoading,
    handlePlaceOrder, handleRazorpaySuccess, handleRazorpayFailed, handleRazorpayDismiss,
    handleUpiDeepLinkSuccess, handleUpiDeepLinkFailed,
    hasActivePaymentSession, sessionSellerUpiId, sessionSellerName, sessionAmount,
    clearPendingPayment, retryPendingPayment, retryPaymentAfterFailure,
    paymentFailureInfo, dismissPaymentFailure: () => setPaymentFailureInfo(null),
    priceChangeInfo, dismissPriceChangeInfo, continueWithUpdatedPrices,
    cancelPlacingOrder: () => { setIsPlacingOrder(false); setOrderStep('validating'); },
    // Pre-order
    hasPreorderItems, maxLeadTimeHours, preorderMissingSchedule,
    scheduledDate, setScheduledDate, scheduledTime, setScheduledTime,
    preorderCutoffTime, preorderSellerIds,
    wantsScheduledDelivery, setWantsScheduledDelivery,
  };
}
