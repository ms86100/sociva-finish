// @ts-nocheck
import { useParams, Link, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ReviewForm } from '@/components/review/ReviewForm';
import { OrderChat } from '@/components/chat/OrderChat';
import { OrderCancellation } from '@/components/order/OrderCancellation';
import { BuyerCancelBooking } from '@/components/booking/BuyerCancelBooking';
import { BuyerRescheduleBooking } from '@/components/booking/BuyerRescheduleBooking';
import { SessionFeedbackPrompt } from '@/components/booking/SessionFeedbackPrompt';
import { SafeSectionWrapper } from '@/components/SafeSectionWrapper';
import { ReorderButton } from '@/components/order/ReorderButton';
import { UrgentOrderTimer } from '@/components/order/UrgentOrderTimer';
import { OrderRejectionDialog } from '@/components/order/OrderRejectionDialog';
import { DeliveryStatusCard } from '@/components/delivery/DeliveryStatusCard';
import { LiveDeliveryTracker } from '@/components/delivery/LiveDeliveryTracker';
import { DeliveryArrivalOverlay } from '@/components/order/DeliveryArrivalOverlay';
import { BuyerDeliveryConfirmation } from '@/components/order/BuyerDeliveryConfirmation';
import { DeliveryETABanner } from '@/components/order/DeliveryETABanner';
import { SellerGPSTracker } from '@/components/delivery/SellerGPSTracker';
import { UpdateBuyerLocationButton } from '@/components/delivery/UpdateBuyerLocationButton';
import { useDeliveryTracking } from '@/hooks/useDeliveryTracking';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { DeliveryCompletionOtpDialog } from '@/components/delivery/DeliveryCompletionOtpDialog';
import { DeliveryFeedbackForm } from '@/components/delivery/DeliveryFeedbackForm';
import { GenericOtpDialog } from '@/components/order/GenericOtpDialog';
import { GenericOtpCard } from '@/components/order/GenericOtpCard';

import { OrderItemCard } from '@/components/order/OrderItemCard';
import { AppointmentDetailsCard } from '@/components/order/AppointmentDetailsCard';
import { useServiceBookingForOrder } from '@/hooks/useServiceBookings';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { OrderHelpSheet } from '@/components/order/OrderHelpSheet';
import { SupportTicketCard } from '@/components/support/SupportTicketCard';
import { SupportTicketDetail } from '@/components/support/SupportTicketDetail';
import { useOrderTickets } from '@/hooks/useSupportTickets';
import { SellerPaymentConfirmation } from '@/components/payment/SellerPaymentConfirmation';
import { SellerCodConfirmation } from '@/components/payment/SellerCodConfirmation';
import { PaymentProofReadonly } from '@/components/payment/PaymentProofReadonly';
import { useOrderDetail } from '@/hooks/useOrderDetail';
import { OrderItem, OrderStatus, PaymentStatus, ItemStatus } from '@/types/database';
import { isTerminalStatus, isSuccessfulTerminal, isFirstFlowStep, stepRequiresOtp, getStepOtpType } from '@/hooks/useCategoryStatusFlow';
import { ArrowLeft, Phone, MapPin, Check, Star, MessageCircle, CreditCard, XCircle, Package, ChevronRight, Copy, Truck, Loader2, AlertTriangle, Clock, CircleCheckBig } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { getString, setString } from '@/lib/persistent-kv';
import { cn } from '@/lib/utils';

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LiveActivityManager } from '@/services/LiveActivityManager';
import { Capacitor } from '@capacitor/core';
import { useNewOrderAlertContext } from '@/contexts/NewOrderAlertContext';

// ─── Zomato-level experience imports ─────────────────────────────────────────
import { deriveDisplayStatus } from '@/lib/deriveDisplayStatus';
import { resolveOrderProgress } from '@/lib/orderProgressStages';
import { ExperienceHeader } from '@/components/order/ExperienceHeader';
import { LiveActivityCard } from '@/components/order/LiveActivityCard';
import { OrderProgressRail } from '@/components/order/OrderProgressRail';
import { OrderTimeline } from '@/components/order/OrderTimeline';
import { PaymentStatusCard } from '@/components/order/PaymentStatusCard';
import { OrderFailureRecovery } from '@/components/order/OrderFailureRecovery';
import { RefundRequestCard } from '@/components/refund/RefundRequestCard';
import { SellerRefundActions } from '@/components/refund/SellerRefundActions';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance } from '@/lib/motion-variants';
import { OrderSuccessOverlay } from '@/components/checkout/OrderSuccessOverlay';
import { OrderTotalsCard } from '@/components/order/OrderTotalsCard';
import { OrderTerminalHero } from '@/components/order/OrderTerminalHero';
import { WhatsAppUpdatesCta } from '@/components/notifications/WhatsAppUpdatesCta';
import { CheckoutSiblingsStrip } from '@/components/order/CheckoutSiblingsStrip';
import { useCheckoutSiblings } from '@/hooks/useCheckoutGroup';
import { checkoutKeyPrefix } from '@/lib/checkout-groups';
import { useAuth } from '@/contexts/AuthContext';

const DeliveryMapView = lazy(() => import('@/components/delivery/DeliveryMapView').then(m => ({ default: m.DeliveryMapView })));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PaymentCheckResult = 'not_captured' | 'captured' | null;

function PaymentConfirmingBanner({
  paymentStatus, paymentType, lastFailedAt, onCheck, onCancel,
}: {
  paymentStatus?: string | null;
  paymentType?: string | null;
  lastFailedAt?: string | null;
  onCheck?: () => Promise<PaymentCheckResult>;
  onCancel?: () => void;
}) {
  const [dots, setDots] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<PaymentCheckResult>(null);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    const i = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowCancel(true), 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, []);

  const awaitingSeller = paymentStatus === 'buyer_confirmed';
  const isOnline = paymentType === 'online' || paymentType === 'razorpay';
  // A recent failure signal from Realtime (via payment.failed webhook) or a
  // manual check that returned no captured payment.
  const hasFailureSignal = checkResult === 'not_captured' || !!lastFailedAt;

  let headline: string;
  let subtitle: string;
  let tone: 'warning' | 'error' = 'warning';

  if (awaitingSeller) {
    headline = `Awaiting seller confirmation${dots}`;
    subtitle = 'Your payment was submitted. The seller must verify before the order is placed.';
  } else if (checkResult === 'not_captured') {
    tone = 'error';
    headline = 'No payment found';
    subtitle = 'We checked with the payment gateway — no completed payment exists for this order. You can retry payment or cancel the order.';
  } else if (lastFailedAt && isOnline) {
    tone = 'error';
    headline = 'Last payment attempt failed';
    subtitle = 'Your most recent payment was not completed. You can retry or cancel the order.';
  } else if (isOnline) {
    headline = `Verifying payment${dots}`;
    subtitle = 'If you completed the payment, it will be confirmed automatically. You can safely close this screen.';
  } else {
    headline = `Waiting for payment${dots}`;
    subtitle = 'Complete your UPI payment and share the UTR number if prompted.';
  }

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const result = await onCheck?.();
      if (result) setCheckResult(result);
    } finally {
      setTimeout(() => setIsChecking(false), 1200);
    }
  };

  const borderClass = tone === 'error'
    ? 'bg-destructive/10 border-destructive/20'
    : 'bg-warning/10 border-warning/20';
  const textClass = tone === 'error' ? 'text-destructive' : 'text-warning';
  const btnClass = tone === 'error'
    ? 'border-destructive/40 text-destructive'
    : 'border-warning/40 text-warning';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className={`border rounded-xl p-4 text-center ${borderClass}`}
    >
      <span className="text-2xl">{tone === 'error' ? '⚠️' : '💳'}</span>
      <p className={`text-sm font-semibold mt-1 ${textClass}`}>{headline}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      {!awaitingSeller && (
        <Button variant="outline" size="sm" className={`mt-3 text-xs font-semibold ${btnClass}`} onClick={handleCheck} disabled={isChecking}>
          {isChecking ? <Loader2 size={12} className="mr-1 animate-spin" /> : <RefreshCw size={12} className="mr-1" />}
          {isChecking ? 'Checking...' : 'Check payment status'}
        </Button>
      )}
      {(showCancel || hasFailureSignal) && onCancel && !awaitingSeller && (
        <div className="mt-2">
          <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={onCancel}>
            Abandon &amp; cancel order
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function CelebrationBanner({ order, isBuyerView, flow }: { order: any; isBuyerView: boolean; flow: any }) {
  const show = isBuyerView && isSuccessfulTerminal(flow, order.status) && !getString(`celebration_${order.id}`);
  useEffect(() => {
    if (show) setString(`celebration_${order.id}`, 'true');
  }, [show, order.id]);
  if (!show) return null;
  const terminalTs = order.status_updated_at || order.updated_at || order.created_at;
  const durationMs = new Date(terminalTs).getTime() - new Date(order.created_at).getTime();
  const durationMin = Math.max(1, Math.round(durationMs / 60000));
  const showDuration = durationMin <= 120;

  // Particle positions for confetti effect
  const particles = [
    { x: -30, y: -20, delay: 0.3 },
    { x: 25, y: -25, delay: 0.4 },
    { x: -20, y: 15, delay: 0.5 },
    { x: 30, y: 10, delay: 0.35 },
    { x: -10, y: -30, delay: 0.45 },
    { x: 15, y: 20, delay: 0.55 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="relative overflow-hidden bg-gradient-to-br from-emerald-500/10 via-emerald-400/5 to-transparent border border-emerald-500/20 rounded-xl p-5 text-center"
    >
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-xl" />

      {/* Animated particles */}
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-8 w-1.5 h-1.5 rounded-full bg-emerald-400/60"
          initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: [0, 1.2, 0] }}
          transition={{ duration: 1.2, delay: p.delay, ease: 'easeOut' }}
        />
      ))}

      {/* SVG Checkmark with draw animation */}
      <div className="relative mx-auto w-12 h-12 mb-3">
        <motion.div
          className="absolute inset-0 rounded-full bg-emerald-500/20"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        <svg
          viewBox="0 0 48 48"
          className="relative w-12 h-12"
          fill="none"
        >
          <motion.circle
            cx="24" cy="24" r="20"
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          />
          <motion.path
            d="M15 24 L21 30 L33 18"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.5, ease: 'easeOut' }}
          />
        </svg>
      </div>

      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.3 }}
        className="relative text-sm font-bold text-foreground"
      >
        {showDuration ? `Delivered in ${durationMin} min!` : 'Order Complete!'}
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.3 }}
        className="relative text-xs text-muted-foreground mt-1"
      >
        Thank you for supporting your community
      </motion.p>
    </motion.div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const o = useOrderDetail(id);
  const { dismissById } = useNewOrderAlertContext();
  const [deliveryAssignmentId, setDeliveryAssignmentId] = useState<string | null>(null);
  const [isOtpDialogOpen, setIsOtpDialogOpen] = useState(false);
  const [isGenericOtpDialogOpen, setIsGenericOtpDialogOpen] = useState(false);
  const [genericOtpTargetStatus, setGenericOtpTargetStatus] = useState<string | null>(null);
  const [hasDeliveryFeedback, setHasDeliveryFeedback] = useState(false);
  const [buyerOtp, setBuyerOtp] = useState<string | null>(null);
  const [roadEtaMinutes, setRoadEtaMinutes] = useState<number | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ totalDistance: number; remainingDistance: number } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: serviceBooking } = useServiceBookingForOrder(o.order?.id);
  const { getSetting } = useSystemSettingsRaw(['proximity_thresholds', 'ui_setting_up_tracking']);
  const { data: orderTickets = [] } = useOrderTickets(o.order?.id);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(() => !!(location.state as any)?.fromCheckout);
  const checkoutOrderCount = (location.state as any)?.orderCount || 1;
  // Notification → Action deep-link continuity: scroll to + pulse the Accept Order hero.
  const acceptHeroRef = useRef<HTMLDivElement | null>(null);
  const [pulseAcceptHero, setPulseAcceptHero] = useState(false);

  const siblingsQuery = useCheckoutSiblings({
    orderId: o.order?.id,
    checkoutGroupId: (o.order as any)?.checkout_group_id,
    idempotencyKey: (o.order as any)?.idempotency_key,
    buyerId: user?.id,
    enabled: !!o.isBuyerView && !!o.order?.id,
  });
  const siblingOrders = siblingsQuery.data || [];

  // Honor ?chat=1 deep-link to auto-open the chat sheet (from notifications/toasts).
  useEffect(() => {
    const search = location.search || (location.hash?.includes('?') ? location.hash.split('?')[1] : '');
    const sp = new URLSearchParams(search);
    if (sp.get('chat') === '1' && o.canChat && o.chatRecipientId) {
      o.setIsChatOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, o.canChat, o.chatRecipientId]);

  // Notification → Action deep-link continuity: scroll to + pulse the Accept Order hero.
  useEffect(() => {
    const search = location.search || (location.hash?.includes('?') ? location.hash.split('?')[1] : '');
    const sp = new URLSearchParams(search);
    const fromNotif = sp.get('from') === 'notification' || (location.state as any)?.from === 'deeplink';
    if (!fromNotif) return;
    if (!o.isSellerView || !o.nextStatus || o.order?.status !== 'placed') return;
    const t = setTimeout(() => {
      acceptHeroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPulseAcceptHero(true);
      setTimeout(() => setPulseAcceptHero(false), 2200);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, o.isSellerView, o.nextStatus, o.order?.status]);

  const order = o.order;
  const orderId = order?.id;
  const fulfillmentType = o.orderFulfillmentType;
  const hasDeliverySteps = o.flow.some((s: any) => s.is_transit === true);
  const isDeliveryOrder = fulfillmentType !== 'self_pickup' && 
    (hasDeliverySteps || ['delivery', 'seller_delivery'].includes(fulfillmentType));

  const deliveryTracking = useDeliveryTracking(deliveryAssignmentId, o.isInTransit);
  const trackingConfig = useTrackingConfig();

  // Dismiss bell sound when this order is opened
  useEffect(() => {
    if (id) dismissById(id);
  }, [id, dismissById]);

  useEffect(() => {
    if (id && order?.status && !['placed', 'enquired', 'quoted'].includes(order.status)) {
      dismissById(id);
    }
  }, [id, order?.status, dismissById]);

  useEffect(() => {
    if (!orderId || !order?.status) return;
    if (!Capacitor.isNativePlatform()) return;
    if (isTerminalStatus(o.flow, order.status)) {
      LiveActivityManager.end(orderId).catch(() => {});
    }
  }, [orderId, order?.status]);

  // RECONCILIATION: If buyer opens a payment_pending online order, trigger backend verification
  const reconcileAttemptedRef = useRef(false);
  useEffect(() => {
    if (!orderId || !order || reconcileAttemptedRef.current) return;
    if (order.status !== 'payment_pending') return;
    if (!o.isBuyerView) return;
    const razorpayOrderId = (order as any).razorpay_order_id;
    if (!razorpayOrderId) return;

    reconcileAttemptedRef.current = true;
    console.log(`[Payment][reconcile] Triggering reconciliation for order=${orderId} razorpay_order_id=${razorpayOrderId}`);
    
    supabase.functions.invoke('confirm-razorpay-payment', {
      body: {
        razorpay_payment_id: null,
        razorpay_order_id: razorpayOrderId,
        order_ids: [orderId],
        source: 'order_detail_reconcile',
      },
    }).then(({ error }) => {
      if (error) {
        console.warn('[Payment][reconcile] result=failed', error);
      } else {
        console.log('[Payment][reconcile] result=success, refetching order');
        o.fetchOrder?.();
      }
    }).catch(err => {
      console.warn('[Payment][reconcile] result=call_failed', err);
    });
  }, [orderId, order?.status]);

  const handlePaymentCheck = useCallback(async (): Promise<PaymentCheckResult> => {
    reconcileAttemptedRef.current = false;
    o.fetchOrder?.();
    const razorpayOrderId = (order as any)?.razorpay_order_id;
    if (!razorpayOrderId || !orderId) return 'not_captured';
    reconcileAttemptedRef.current = true;
    const { data, error } = await supabase.functions.invoke('confirm-razorpay-payment', {
      body: { razorpay_payment_id: null, razorpay_order_id: razorpayOrderId, order_ids: [orderId], source: 'manual_check' },
    }).catch(() => ({ data: null, error: true }));
    if (!error && (data as any)?.success === true) {
      o.fetchOrder?.();
      return 'captured';
    }
    o.fetchOrder?.();
    return 'not_captured';
  }, [orderId, order, o.fetchOrder]);

  const handleAbandonPayment = useCallback(async () => {
    if (!orderId) return;
    await supabase.rpc('buyer_cancel_pending_orders' as any, { _order_ids: [orderId] }).catch(() => {});
    o.fetchOrder?.();
  }, [orderId, o.fetchOrder]);

  // Resilient assignment hydration
  const [assignmentRetryCount, setAssignmentRetryCount] = useState(0);

  useEffect(() => {
    if (!isDeliveryOrder || !orderId) return;

    const fetchAssignment = () => {
      supabase
        .from('delivery_assignments')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) { console.warn('Assignment fetch error:', error.message); return; }
          if (data) setDeliveryAssignmentId(data.id);
          else {
            if (assignmentRetryCount < 10) {
              const delay = Math.min(1500 * (assignmentRetryCount + 1), 15000);
              setTimeout(() => setAssignmentRetryCount(c => c + 1), delay);
            }
          }
        });
    };
    fetchAssignment();

    const channel = supabase
      .channel(`assignment-watch-${orderId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_assignments',
        filter: `order_id=eq.${orderId}`,
      }, (payload) => {
        const newId = (payload.new as any)?.id;
        if (newId) setDeliveryAssignmentId(newId as string);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId, isDeliveryOrder, assignmentRetryCount]);

  // Fetch delivery OTP for buyer
  useEffect(() => {
    if (!deliveryAssignmentId || !isDeliveryOrder) return;

    supabase
      .from('delivery_assignments')
      .select('delivery_code')
      .eq('id', deliveryAssignmentId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.delivery_code) setBuyerOtp(data.delivery_code);
      });

    const otpChannel = supabase
      .channel(`otp-watch-${deliveryAssignmentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'delivery_assignments',
        filter: `id=eq.${deliveryAssignmentId}`,
      }, (payload) => {
        const code = (payload.new as any)?.delivery_code;
        if (code) setBuyerOtp(code);
      })
      .subscribe();

    return () => { supabase.removeChannel(otpChannel); };
  }, [isDeliveryOrder, deliveryAssignmentId]);

  // Listen for OTP-required events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.orderId === orderId) setIsOtpDialogOpen(true);
    };
    window.addEventListener('delivery-otp-required', handler);
    return () => window.removeEventListener('delivery-otp-required', handler);
  }, [orderId]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await o.fetchOrder?.();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [o.fetchOrder]);

  // Route info callback
  const handleRouteInfo = useCallback((info: { totalDistance: number; remainingDistance: number }) => {
    setRouteInfo(info);
  }, []);

  if (o.isLoading) return <AppLayout showHeader={false}><div className="p-4 space-y-3"><Skeleton className="h-8 w-32" /><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div></AppLayout>;
  if (!order) return <AppLayout showHeader={false}><div className="p-4 text-center py-16"><p className="text-sm text-muted-foreground">Order not found</p><Link to="/orders"><Button size="sm" className="mt-4">View Orders</Button></Link></div></AppLayout>;

  const seller = o.seller;
  const sellerProfile = seller?.profile;
  const buyer = (order as any).buyer;
  const items: OrderItem[] = (order as any).items || [];
  const hasItemsField = 'items' in (order as any);
  const viewRole: 'buyer' | 'seller' = o.isSellerView ? 'seller' : 'buyer';
  const paymentStatusInfo = o.getPaymentStatus((order.payment_status as PaymentStatus) || 'pending');
  const isInTransit = o.isInTransit;
  const currentActors = (o.currentStepActor || '').split(',').map(a => a.trim());

  // ─── Derive display status (Zomato engine) ───────────────────────────────
  const displayStatus = deriveDisplayStatus({
    orderStatus: order.status,
    flow: o.flow,
    isBuyerView: o.isBuyerView,
    fulfillmentType: fulfillmentType,
    roadEtaMinutes,
    estimatedDeliveryAt: (order as any).estimated_delivery_at,
    sellerName: seller?.business_name,
    totalRouteDistance: routeInfo?.totalDistance,
    remainingDistance: routeInfo?.remainingDistance,
    hasRiderLocation: !!deliveryTracking.riderLocation,
  });

  const orderProgress = resolveOrderProgress({
    status: order.status,
    fulfillmentType,
    flowIsTransit: o.flow.find((s: any) => s.status_key === order.status)?.is_transit === true,
  });

  const showArrivalOverlay = o.isBuyerView && !isTerminalStatus(o.flow, order.status) && deliveryAssignmentId && deliveryTracking.riderLocation && deliveryTracking.distance != null && deliveryTracking.distance < trackingConfig.arrival_overlay_distance_meters;

  // Defensive guard: render the seller action bar even when flow rows are missing,
  // as long as we have a resolvable next status (via transitions-only fallback in useOrderDetail).
  const hasResolvableSellerCTA = !!o.nextStatus || o.canSellerReject;
  const hasSellerActionBar = o.isSellerView && !o.isFlowLoading && !isTerminalStatus(o.flow, order.status) && (o.flow.length > 0 || hasResolvableSellerCTA);
  const canRescheduleBooking = !!serviceBooking && ['confirmed', 'scheduled', 'rescheduled'].includes(serviceBooking.status);
  const hasBuyerActionBar = o.isBuyerView && !o.isFlowLoading && o.flow.length > 0 && !isTerminalStatus(o.flow, order.status) && (o.buyerNextStatus || o.canBuyerCancel || canRescheduleBooking);

  // Show the prominent "Accept Order" hero card when the seller is on a fresh placed order.
  const showAcceptHero = o.isSellerView && order.status === 'placed' && !!o.nextStatus && !o.isFlowLoading;

  const getActionLabel = (status: string, otpRequired: boolean) => {
    const step = o.flow.find(s => s.status_key === status);
    const roleLabel = (viewRole === 'seller' && step?.seller_display_label)
      ? step.seller_display_label
      : (viewRole === 'buyer' && step?.buyer_display_label)
        ? step.buyer_display_label
        : step?.display_label;
    const label = roleLabel || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const isEnd = step?.is_terminal === true;
    if (otpRequired) return isEnd ? 'Verify & Complete' : `Verify & ${label}`;
    return isEnd ? 'Complete Order' : `Mark ${label}`;
  };

  // Seller context message (Condition #5: no ambiguity)
  const getSellerContextMessage = () => {
    if (!o.isSellerView) return null;
    const step = o.flow.find(s => s.status_key === order.status);
    if (step?.seller_hint) return step.seller_hint;

    switch (displayStatus.phase) {
      case 'placed': return 'New order — review and accept';
      case 'preparing': return 'Prepare the items and mark ready when done';
      case 'ready': return 'Waiting for customer pickup';
      case 'transit': return 'Order is on the way to the customer';
      case 'delivered': return 'Order completed successfully';
      default: return null;
    }
  };

  return (
    <AppLayout showHeader={false} showNav={!hasSellerActionBar || !o.isSellerView} safeTop={false}>
      {showSuccessOverlay && (
        <OrderSuccessOverlay
          show={showSuccessOverlay}
          onDismiss={() => setShowSuccessOverlay(false)}
          orderCount={checkoutOrderCount}
        />
      )}
      <div className={`${(hasSellerActionBar || hasBuyerActionBar) ? 'pb-40' : 'pb-56'}`}>
        {/* ═══ Experience Header (replaces old header) ═══ */}
        <ExperienceHeader
          sellerName={o.isSellerView ? (buyer?.name || 'Customer') : (seller?.business_name || 'Seller')}
          displayStatus={displayStatus}
          orderId={order.id}
          onBack={() => {
            if (location.state?.from === 'deeplink' || window.history.length <= 2) {
              navigate('/orders');
            } else {
              navigate(-1);
            }
          }}
          onCopyId={o.copyOrderId}
          onRefresh={handleRefresh}
          onChatOpen={o.canChat && o.chatRecipientId ? () => o.setIsChatOpen(true) : undefined}
          unreadMessages={o.unreadMessages}
          canChat={o.canChat && !!o.chatRecipientId}
          isTerminal={isTerminalStatus(o.flow, order.status)}
          isRefreshing={isRefreshing}
        />

        <motion.div
          className="px-4 pt-3 space-y-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {o.isBuyerView && siblingOrders.length > 1 && (
            <motion.div variants={cardEntrance}>
              <CheckoutSiblingsStrip
                siblings={siblingOrders}
                currentOrderId={order.id}
                checkoutGroupId={
                  (order as any).checkout_group_id ||
                  (checkoutKeyPrefix((order as any).idempotency_key)
                    ? `soft:${checkoutKeyPrefix((order as any).idempotency_key)}`
                    : null)
                }
              />
            </motion.div>
          )}

          {/* ═══ Seller: Prominent Accept Order hero (above the fold) ═══ */}
          {showAcceptHero && (
            <motion.div
              ref={acceptHeroRef}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
              className={cn(
                "bg-gradient-to-r from-primary/10 via-primary/5 to-accent/10 border-2 rounded-2xl p-4 shadow-sm transition-all",
                pulseAcceptHero ? "border-primary ring-4 ring-primary/30" : "border-primary/30"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <CircleCheckBig size={22} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">New Order — Action Required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {buyer?.name ? `${buyer.name} is waiting` : 'Customer is waiting for your confirmation'} · Tap Accept to start preparing
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {o.canSellerReject && (
                  <Button
                    variant="outline"
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground h-11"
                    onClick={() => o.setIsRejectionDialogOpen(true)}
                    disabled={o.isUpdating}
                  >
                    <XCircle size={15} className="mr-1.5" /> Reject
                  </Button>
                )}
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 h-11 font-semibold"
                  onClick={() => o.updateOrderStatus(o.nextStatus!)}
                  disabled={o.isUpdating}
                >
                  {o.isUpdating ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Check size={15} className="mr-1.5" />}
                  Accept Order
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══ Seller: shared 4-stage progress rail (same as buyer) ═══ */}
          {o.isSellerView && orderProgress.kind === 'stages' && !isTerminalStatus(o.flow, order.status) && order.status !== 'cancelled' && (
            <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm">
              <OrderProgressRail
                stages={orderProgress.stages}
                currentIndex={orderProgress.stageIndex}
                title="Order Progress"
                hint={
                  o.getSellerHint(order.status) ||
                  orderProgress.subtext ||
                  null
                }
              />
            </motion.div>
          )}

          {/* ═══ Buyer: Live Activity Card (simplified) ═══ */}
          {o.isBuyerView && orderProgress.kind === 'stages' && !isTerminalStatus(o.flow, order.status) && order.status !== 'cancelled' && (
            <motion.div variants={cardEntrance}><LiveActivityCard
              displayStatus={displayStatus}
              sellerName={seller?.business_name || 'Seller'}
              riderName={deliveryTracking.riderName}
              riderPhone={deliveryTracking.riderPhone}
              hasGps={!!deliveryTracking.riderLocation}
              isLocationStale={deliveryTracking.isLocationStale}
              lastUpdateAt={deliveryTracking.lastLocationAt}
              distanceMeters={deliveryTracking.distance}
              currentStatus={order.status}
              fulfillmentType={fulfillmentType}
              flowIsTransit={o.flow.find((s: any) => s.status_key === order.status)?.is_transit === true}
              stageHint={o.getBuyerHint(order.status)}
            /></motion.div>
          )}

          {/* WhatsApp opt-in — opens 24h CSW after user sends Hi (dismissible / once opted-in) */}
          {o.isBuyerView && !isTerminalStatus(o.flow, order.status) && order.status !== 'cancelled' && order.status !== 'payment_pending' && (
            <motion.div variants={cardEntrance}>
              <WhatsAppUpdatesCta variant="compact" audience="buyer" />
            </motion.div>
          )}

          {/* Seller context message (Condition #5: clear action state) */}
          {o.isSellerView && !isTerminalStatus(o.flow, order.status) && (() => {
            const msg = getSellerContextMessage();
            return msg ? (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5">
                <p className="text-xs font-medium text-primary">{msg}</p>
              </div>
            ) : null;
          })()}

          {o.isSellerView && !isTerminalStatus(o.flow, order.status) && (
            <WhatsAppUpdatesCta variant="compact" audience="seller" />
          )}

          {/* Celebration banner */}
          <CelebrationBanner order={order} isBuyerView={o.isBuyerView} flow={o.flow} />

          {/* Order placed celebration */}
          {o.isBuyerView && isFirstFlowStep(o.flow, order.status) && order.status !== 'payment_pending' && (Date.now() - new Date(order.created_at).getTime() < 60000) && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-center"
            >
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center mb-2">
                <CircleCheckBig size={20} className="text-primary" />
              </div>
              <p className="text-sm font-bold text-primary">Order Placed Successfully!</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your order is being reviewed by the seller</p>
              {(order as any).estimated_delivery_at && (
                <p className="text-xs font-medium text-primary mt-1">
                  Estimated delivery: {format(new Date((order as any).estimated_delivery_at), 'h:mm a')}
                </p>
              )}
            </motion.div>
          )}

          {/* Scheduled delivery date */}
          {(order as any).scheduled_date && (
            <div className="bg-accent/10 border border-accent/20 rounded-xl p-3 flex items-start gap-2.5">
              <Clock size={16} className="text-accent shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Scheduled Order</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  📅 {format(new Date((order as any).scheduled_date), 'EEEE, MMM d, yyyy')}
                  {(order as any).scheduled_time_start && ` at ${(order as any).scheduled_time_start.slice(0, 5)}`}
                </p>
              </div>
            </div>
          )}

          {/* Urgent timers */}
          {o.isBuyerView && order.auto_cancel_at && order.status !== 'payment_pending' && !isTerminalStatus(o.flow, order.status) && (
            <UrgentOrderTimer autoCancelAt={order.auto_cancel_at} onTimeout={o.handleTimeout} variant="buyer" />
          )}

          {o.isBuyerView && isFirstFlowStep(o.flow, order.status) && order.status !== 'payment_pending' && !o.isUrgentOrder && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
              <Loader2 size={14} className="animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">
                Waiting for {seller?.business_name || 'seller'} to confirm…
                {(seller as any)?.avg_response_minutes > 0
                  ? <span className="font-medium text-foreground"> Usually responds in ~{(seller as any).avg_response_minutes} min</span>
                  : <span className="font-medium text-foreground"> Sellers typically respond within a few minutes</span>
                }
              </p>
            </div>
          )}

          {o.isBuyerView && order.status === 'payment_pending' && (
            <PaymentConfirmingBanner
              paymentStatus={(order as any).payment_status}
              paymentType={(order as any).payment_type}
              lastFailedAt={(order as any).last_payment_failed_at ?? null}
              onCheck={handlePaymentCheck}
              onCancel={handleAbandonPayment}
            />
          )}

          {o.isSellerView && order.auto_cancel_at && !isTerminalStatus(o.flow, order.status) && <UrgentOrderTimer autoCancelAt={order.auto_cancel_at} onTimeout={o.handleTimeout} variant="seller" />}

          {/* Attention banners */}
          {o.isBuyerView && (order as any).needs_attention && !isTerminalStatus(o.flow, order.status) && (
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 flex items-start gap-2.5">
              <AlertTriangle className="text-warning shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-sm font-semibold text-warning">Attention Needed</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(order as any).needs_attention_reason || 'There may be a delay with your order. Contact the seller if needed.'}
                </p>
                {sellerProfile?.phone && (
                  <a href={`tel:${sellerProfile.phone}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-1.5">
                    <Phone size={12} /> Contact Seller
                  </a>
                )}
              </div>
            </div>
          )}

          {order.rejection_reason && isTerminalStatus(o.flow, order.status) && !isSuccessfulTerminal(o.flow, order.status) && (
            <OrderTerminalHero
              variant="cancelled"
              reason={(() => {
                const r = order.rejection_reason || '';
                const cleaned = r.replace(/^Cancelled by buyer:\s*/i, '');
                const who = r.startsWith('Cancelled by buyer:')
                  ? (o.isBuyerView ? 'You cancelled this order' : 'Cancelled by buyer')
                  : /not completed in time|seller didn't respond|payment was not completed/i.test(r)
                    ? 'Auto-cancelled'
                    : (o.isSellerView ? 'You cancelled this order' : 'Cancelled by seller');
                return `${who}${cleaned ? ` — ${cleaned}` : ''}`;
              })()}
              whenISO={order.status_updated_at || order.updated_at || order.created_at}
              items={items}
              sellerId={order.seller_id}
              showReorder={o.isBuyerView}
            />
          )}

          {/* ═══ Bill Details — promoted: visible right under hero/cancelled banner ═══ */}
          {(() => {
            const subtotal = items.reduce((s: number, it: OrderItem) => s + it.unit_price * it.quantity, 0);
            const totalSavings = items.reduce((sum: number, item: OrderItem) => {
              const mrp = (item as any).mrp;
              if (mrp && mrp > item.unit_price) return sum + (mrp - item.unit_price) * item.quantity;
              return sum;
            }, 0);
            return (
              <OrderTotalsCard
                subtotal={subtotal}
                total={order.total_amount}
                discount={(order as any).discount_amount || 0}
                deliveryFee={(order as any).delivery_fee || 0}
                isDeliveryOrder={isDeliveryOrder}
                savings={totalSavings}
                itemCount={items.length}
              />
            );
          })()}

          {/* ═══ MAP + LIVE TRACKING — Prominent during transit ═══ */}
          {isDeliveryOrder && isInTransit && (
            <>
              {(() => {
                const riderLoc = deliveryTracking.riderLocation;
                const sellerLatVal = (seller as any)?.latitude || null;
                const sellerLngVal = (seller as any)?.longitude || null;
                const originLat = riderLoc?.latitude ?? sellerLatVal;
                const originLng = riderLoc?.longitude ?? sellerLngVal;
                const destLat = (order as any).delivery_lat || (buyer as any)?.latitude || null;
                const destLng = (order as any).delivery_lng || (buyer as any)?.longitude || null;
                return destLat && destLng ? (
                  <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-xl" />}>
                    <DeliveryMapView
                      riderLat={originLat || sellerLatVal || destLat}
                      riderLng={originLng || sellerLngVal || destLng}
                      destinationLat={destLat}
                      destinationLng={destLng}
                      riderName={deliveryTracking.riderName || (seller as any)?.business_name || ''}
                      heading={riderLoc?.heading}
                      onRoadEtaChange={setRoadEtaMinutes}
                      sellerLat={sellerLatVal}
                      sellerLng={sellerLngVal}
                      sellerName={seller?.business_name}
                      isPickedUp={['picked_up', 'on_the_way', 'at_gate'].includes(order.status)}
                      tall={true}
                      onRouteInfo={handleRouteInfo}
                    />
                  </Suspense>
                ) : null;
              })()}

              {/* Rider info card */}
              {deliveryAssignmentId ? (
                <LiveDeliveryTracker assignmentId={deliveryAssignmentId} isBuyerView={o.isBuyerView} trackingState={deliveryTracking} roadEtaMinutes={roadEtaMinutes} isInTransit={isInTransit} displayStatusText={displayStatus.text} statusHints={(() => {
                  const hints: Record<string, { buyer_hint?: string | null; seller_hint?: string | null; display_label?: string | null }> = {};
                  for (const step of o.flow) {
                    hints[step.status_key] = { buyer_hint: step.buyer_hint, seller_hint: (step as any).seller_hint, display_label: step.display_label };
                  }
                  return hints;
                })()} />
              ) : o.flow.some((s: any) => s.creates_tracking_assignment) ? (
                <div className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-3 justify-center text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" />
                    <p className="text-sm">{getSetting('ui_setting_up_tracking') || 'Setting up live tracking...'}</p>
                  </div>
                </div>
              ) : null}

              {o.isBuyerView && (
                <div className="flex justify-end">
                  <UpdateBuyerLocationButton orderId={order.id} />
                </div>
              )}
            </>
          )}

          {/* Seller GPS tracker */}
          {isDeliveryOrder && o.isSellerView && (order as any).delivery_handled_by !== 'platform' && o.isInTransit && (
            <SellerGPSTracker assignmentId={deliveryAssignmentId} orderId={order.id} autoStart deliveryStatus={order.status} />
          )}

          {/* Delivery partner card — pre-transit */}
          {o.isBuyerView && isDeliveryOrder && deliveryAssignmentId && deliveryTracking.riderName && !isTerminalStatus(o.flow, order.status) && !isInTransit && (
            <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-3 flex items-center gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Truck size={18} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Your delivery partner</p>
                <p className="text-sm font-semibold truncate">{deliveryTracking.riderName}</p>
              </div>
              {deliveryTracking.riderPhone && (
                <a href={`tel:${deliveryTracking.riderPhone}`} className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                  <Phone size={16} className="text-accent" />
                </a>
              )}
             </motion.div>
          )}

          {/* Delivery OTP card — only for platform-managed delivery (rider holds the code) */}
          {o.isBuyerView && isDeliveryOrder && buyerOtp && (order as any).delivery_handled_by === 'platform' && !isTerminalStatus(o.flow, order.status) && (isInTransit || ['picked_up', 'on_the_way', 'at_gate'].includes(order.status) || (() => {
            const nextStatus = o.buyerNextStatus || o.nextStatus;
            if (!nextStatus) return false;
            const nextOtp = getStepOtpType(o.flow, nextStatus);
            return nextOtp === 'delivery';
          })()) && (
            <div className="bg-primary/5 border-2 border-primary/20 rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Your Delivery Code</p>
              <p className="text-3xl font-bold tracking-[0.3em] text-primary">{buyerOtp}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">Share this code with the delivery person to confirm delivery</p>
              <p className="text-[10px] text-warning mt-1.5">⚠️ Only share when you've received your items. This code confirms delivery is complete.</p>
            </div>
          )}

          {/* Buyer: Generic OTP for seller-managed delivery (buyer shares code with seller) */}
          {o.isBuyerView && isDeliveryOrder && (order as any).delivery_handled_by !== 'platform' && !isTerminalStatus(o.flow, order.status) && (() => {
            const nextStatus = o.buyerNextStatus || o.nextStatus;
            if (!nextStatus) return false;
            const nextOtp = getStepOtpType(o.flow, nextStatus);
            return nextOtp === 'delivery' || nextOtp === 'delivery_otp';
          })() && (
            <GenericOtpCard orderId={order.id} targetStatus={(() => {
              const ns = o.buyerNextStatus || o.nextStatus;
              return ns || '';
            })()} targetStatusLabel={(() => {
              const ns = o.buyerNextStatus || o.nextStatus;
              return ns ? o.getFlowStepLabel(ns, 'buyer').label : 'Delivered';
            })()} />
          )}

          {/* Self-pickup OTP card — buyer sees the code to share with seller */}
          {o.isBuyerView && fulfillmentType === 'self_pickup' && !isTerminalStatus(o.flow, order.status) && (() => {
            const nextStatus = o.buyerNextStatus || o.nextStatus;
            if (!nextStatus) return null;
            const nextOtpType = getStepOtpType(o.flow, nextStatus);
            if (nextOtpType !== 'generic') return null;
            const nextStepActors = (o.flow.find((s: any) => s.status_key === nextStatus)?.actor || '').split(',').map((a: string) => a.trim());
            const isAdvancer = (o.isBuyerView && nextStepActors.includes('buyer'));
            if (isAdvancer) return null;
            return (
              <div className="bg-primary/5 border-2 border-primary/20 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Your Pickup Code</p>
                <GenericOtpCard orderId={order.id} targetStatus={nextStatus} targetStatusLabel={o.getFlowStepLabel(nextStatus, viewRole).label} />
                <p className="text-[10px] text-warning mt-1.5">⚠️ Share this code with the seller when you collect your order</p>
              </div>
            );
          })()}

          {/* Generic OTP card — buyer also sees code when seller is the advancer (buyer shares it with seller) */}
          {(() => {
            // For buyer: fall back to the global nextStatus when buyerNextStatus is null
            // (e.g. seller-driven transitions like ready→picked_up where buyer must share OTP)
            const nextStatus = o.isSellerView ? o.nextStatus : (o.buyerNextStatus || o.nextStatus);
            if (!nextStatus || isTerminalStatus(o.flow, order.status)) return null;
            const nextOtpType = getStepOtpType(o.flow, nextStatus);
            if (nextOtpType !== 'generic') return null;
            // Skip if already rendered by self-pickup OTP above
            if (o.isBuyerView && fulfillmentType === 'self_pickup') return null;
            const nextStepActors = (o.flow.find((s: any) => s.status_key === nextStatus)?.actor || '').split(',').map((a: string) => a.trim());
            const isAdvancer = (o.isSellerView && nextStepActors.includes('seller')) || (o.isBuyerView && nextStepActors.includes('buyer'));
            if (isAdvancer) return null;
            return <GenericOtpCard orderId={order.id} targetStatus={nextStatus} targetStatusLabel={o.getFlowStepLabel(nextStatus, viewRole).label} />;
          })()}

          {isDeliveryOrder && !isInTransit && !o.isBuyerView && <DeliveryStatusCard orderId={order.id} isBuyerView={o.isBuyerView} flow={o.flow} />}

          {o.isBuyerView && isDeliveryOrder && (order as any).estimated_delivery_at && !isTerminalStatus(o.flow, order.status) && !(deliveryAssignmentId && deliveryTracking.eta) && (
            <DeliveryETABanner estimatedDeliveryAt={(order as any).estimated_delivery_at} />
          )}

          {/* Fulfillment Method Card */}
          <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {isDeliveryOrder ? (
                  <Truck size={16} className="text-primary" />
                ) : (
                  <Package size={16} className="text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {fulfillmentType === 'seller_delivery' || (fulfillmentType === 'delivery' && (order as any).delivery_handled_by !== 'platform')
                      ? 'Seller Delivery'
                      : fulfillmentType === 'delivery'
                        ? 'Delivery Partner'
                        : fulfillmentType === 'at_seller'
                          ? 'At Seller Location'
                          : fulfillmentType === 'at_buyer'
                            ? 'At Your Location'
                            : 'Self Pickup'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isDeliveryOrder
                      ? 'Will be delivered to your address'
                      : fulfillmentType === 'at_seller' || fulfillmentType === 'at_buyer'
                        ? 'Service appointment'
                        : 'Pick up from seller location'}
                  </p>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                isDeliveryOrder ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {isDeliveryOrder ? '🚚 Delivery' : '📦 Pickup'}
              </span>
            </div>
          </motion.div>

          {/* Appointment Details */}
          <SafeSectionWrapper name="AppointmentDetails">
            {serviceBooking && (
              <AppointmentDetailsCard
                booking={serviceBooking}
                title={items[0]?.product_name || 'Service appointment'}
                sellerName={seller?.business_name}
                notes={(order as any).notes || (order as any).delivery_notes || null}
              />
            )}
          </SafeSectionWrapper>

          {o.isBuyerView && serviceBooking?.status === 'completed' && (
            <SessionFeedbackPrompt
              bookingId={serviceBooking.id}
              bookingStatus={serviceBooking.status}
            />
          )}

          {/* Payment */}
          <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5"><CreditCard size={16} className="text-muted-foreground" /><p className="text-sm font-medium">{(() => { const pt = (order as any).payment_type || (order as any).payment_method; if (pt === 'cod') return 'Cash on Delivery'; if (pt === 'upi' || pt === 'online' || pt === 'card') return 'Online Payment'; return 'Online Payment'; })()}</p></div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${paymentStatusInfo.color}`}>{paymentStatusInfo.label}</span>
            </div>
            {(order as any).upi_transaction_ref && (
              <div className="mt-2 pt-2 border-t border-border">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Transaction ID (UTR)</p>
                <p className="text-sm font-mono font-medium mt-0.5">{(order as any).upi_transaction_ref}</p>
              </div>
            )}
          </motion.div>

          {/* Seller Payment Confirmation — show whenever buyer has claimed UPI payment and seller hasn't verified yet, regardless of order status (delivery may already be complete) */}
          {o.isSellerView && (order as any).payment_status === 'buyer_confirmed' && (order as any).payment_confirmed_by_seller === null && (
            <SellerPaymentConfirmation
              orderId={order.id}
              amount={order.total_amount}
              utrRef={(order as any).upi_transaction_ref}
              buyerName={buyer?.name}
              screenshotUrl={(order as any).payment_screenshot_url}
              onConfirmed={() => o.fetchOrder()}
            />
          )}

          {/* COD Payment Confirmation — mid-flow awaiting_cod_confirmation or successful terminal */}
          {o.isSellerView && (order as any).payment_type === 'cod' && (order as any).payment_status !== 'paid' && (order.status === 'awaiting_cod_confirmation' || isSuccessfulTerminal(o.flow, order.status)) && (
            <SellerCodConfirmation
              orderId={order.id}
              amount={order.total_amount}
              buyerName={buyer?.name}
              onConfirmed={() => o.fetchOrder()}
            />
          )}

          {/* Payment proof readonly — only when seller has already verified (no pending action) */}
          {o.isSellerView && (order as any).payment_screenshot_url && (order as any).payment_confirmed_by_seller !== null && (
            <PaymentProofReadonly
              screenshotUrl={(order as any).payment_screenshot_url}
              utrRef={(order as any).upi_transaction_ref}
            />
          )}

          {/* Refund Request — Buyer view (hide for seller to avoid duplicate) */}
          {!o.isSellerView && (
            <RefundRequestCard
              orderId={order.id}
              orderStatus={order.status}
              paymentStatus={(order as any).payment_status || ''}
              isBuyerView={o.isBuyerView}
              totalAmount={order.total_amount}
              onRefundRequested={() => o.fetchOrder()}
            />
          )}

          {/* Refund Request — Seller actions */}
          {o.isSellerView && <SellerRefundSection orderId={order.id} onAction={() => o.fetchOrder()} />}

          {/* Support Tickets & Help */}
          {o.isBuyerView && !isTerminalStatus(o.flow, order.status) && (
            <OrderHelpSheet
              orderId={order.id}
              orderStatus={order.status}
              paymentStatus={(order as any).payment_status}
              estimatedDeliveryAt={(order as any).estimated_delivery_at}
              sellerId={order.seller_id}
              sellerName={seller?.business_name}
              societyId={(order as any).society_id}
              onChatOpen={o.chatRecipientId ? () => o.setIsChatOpen(true) : undefined}
            />
          )}

          {/* Active support tickets */}
          <SafeSectionWrapper name="SupportTickets">
            {orderTickets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Support Tickets</p>
                {orderTickets.map((ticket) => (
                  <SupportTicketCard key={ticket.id} ticket={ticket} viewRole={viewRole} onClick={() => setSelectedTicket(ticket)} />
                ))}
              </div>
            )}
          </SafeSectionWrapper>

          <SupportTicketDetail
            ticket={selectedTicket}
            open={!!selectedTicket}
            onOpenChange={(open) => { if (!open) setSelectedTicket(null); }}
            viewRole={viewRole}
          />

          {o.canReorder && (
            <div className="bg-accent/10 border border-accent/20 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5"><Package className="text-accent" size={18} /><div><p className="text-sm font-semibold">Order again?</p><p className="text-[11px] text-muted-foreground">Same items, one tap</p></div></div>
              <ReorderButton orderItems={items} sellerId={order.seller_id} size="sm" />
            </div>
          )}

          {/* Feedback */}
          {o.isBuyerView && isSuccessfulTerminal(o.flow, order.status) && !getString(`feedback_prompted_${order.id}`) && (
            <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5"><span className="text-lg">💬</span><div><p className="text-sm font-semibold">How was your experience?</p><p className="text-[11px] text-muted-foreground">Share feedback</p></div></div>
              <FeedbackSheet triggerLabel="Share" onSubmitted={() => setString(`feedback_prompted_${order.id}`, 'true')} />
            </div>
          )}

          {o.canReview && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 2, duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
              className="bg-gradient-to-r from-warning/15 to-warning/5 border border-warning/30 rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center">
                    <Star className="text-warning fill-warning" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Rate {seller?.business_name || 'this order'}</p>
                    <p className="text-[11px] text-muted-foreground">Your review helps your neighbors discover great sellers</p>
                  </div>
                </div>
                <ReviewForm orderId={order.id} sellerId={order.seller_id} sellerName={seller?.business_name || 'Seller'} onSuccess={() => o.setHasReview(true)} />
              </div>
            </motion.div>
          )}

          {/* Delivery feedback */}
          {o.isBuyerView && isDeliveryOrder && isSuccessfulTerminal(o.flow, order.status) && !hasDeliveryFeedback && (
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🚚</span>
                <div>
                  <p className="text-sm font-semibold">Rate the delivery</p>
                  <p className="text-[11px] text-muted-foreground">Punctuality, handling & experience</p>
                </div>
              </div>
              <DeliveryFeedbackForm orderId={order.id} sellerId={order.seller_id} onSuccess={() => setHasDeliveryFeedback(true)} />
            </div>
          )}

          {/* Seller/Buyer Info */}
          <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{o.isSellerView ? 'Customer' : 'Seller'}</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{o.isSellerView ? (buyer?.name || 'Customer') : (seller?.business_name || 'Seller')}</p>
                {(() => {
                   const block = o.isSellerView ? buyer?.block : sellerProfile?.block;
                   const flat = o.isSellerView ? buyer?.flat_number : sellerProfile?.flat_number;
                   return (block || flat) ? (
                     <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin size={11} />{block ? `Block ${block}` : ''}{block && flat ? ', ' : ''}{flat || ''}</p>
                   ) : null;
                })()}
                {(order as any).delivery_address && ['delivery', 'seller_delivery'].includes((order as any).fulfillment_type) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><MapPin size={11} />Delivering to: {(order as any).delivery_address}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {o.isBuyerView && sellerProfile?.phone && ['contact_seller', 'request_service'].includes((order as any).action_type || '') && (
                  <a
                    href={`https://wa.me/${sellerProfile.phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center shrink-0"
                    title="WhatsApp seller"
                  >
                    <Phone size={16} className="text-green-600" />
                  </a>
                )}
                {(o.isSellerView ? buyer?.phone : sellerProfile?.phone) && (
                  <a href={`tel:${o.isSellerView ? buyer?.phone : sellerProfile?.phone}`} className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center shrink-0"><Phone size={16} className="text-accent" /></a>
                )}
              </div>
            </div>
          </motion.div>

          {/* Items */}
          <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-2xl p-4 shadow-[0_2px_12px_-6px_hsl(var(--foreground)/0.08)]">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center">
                <Package size={14} className="text-accent" />
              </div>
              <p className="text-xs font-semibold text-foreground tracking-wide">Items</p>
              {items.length > 1 && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {items.filter((i: OrderItem) => (i.status || 'pending') === 'delivered').length}/{items.length} done
                </span>
              )}
            </div>
            {!hasItemsField && items.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Unable to load order items</p>
            )}
            {items.length > 1 && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {(['pending', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'] as ItemStatus[]).map((status) => {
                  const count = items.filter((i: OrderItem) => (i.status || 'pending') === status).length;
                  if (count === 0) return null;
                  return <span key={status} className={`text-[10px] px-1.5 py-0.5 rounded ${o.getItemStatus(status).color}`}>{count} {o.getItemStatus(status).label}</span>;
                })}
              </div>
            )}
            <div>
              {items.map((item: OrderItem, idx: number) => (
                <OrderItemCard key={item.id} item={item} index={idx} isSellerView={o.isSellerView} orderStatus={order.status} onStatusUpdate={(itemId, newStatus) => {
                  const updatedItems = items.map((i: OrderItem) => i.id === itemId ? { ...i, status: newStatus } : i);
                  o.setOrder({ ...order, items: updatedItems } as any);
                }} />
              ))}
            </div>
          </motion.div>

          {/* Totals — already rendered above the fold */}

          {order.notes && (<motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Instructions</p><p className="text-sm text-muted-foreground">{order.notes}</p></motion.div>)}

          {/* Payment Status */}
          <PaymentStatusCard orderId={order.id} paymentType={(order as any).payment_type} totalAmount={order.total_amount} orderStatus={order.status} orderPaymentStatus={(order as any).payment_status} />

          {/* Order Failure Recovery */}
          <OrderFailureRecovery orderId={order.id} orderStatus={order.status} />

          {/* Order Timeline */}
          <OrderTimeline orderId={order.id} />
        </motion.div>
      </div>

      {/* Seller Action Bar — loading state */}
      {o.isSellerView && o.isFlowLoading && !isTerminalStatus(o.flow, order.status) && (
        <div className="fixed bottom-[env(safe-area-inset-bottom)] left-0 right-0 z-40 bg-background/80 backdrop-blur-xl border-t border-border/50">
          <div className="px-4 py-3 flex items-center justify-center gap-2 h-12 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span>Loading actions…</span>
          </div>
        </div>
      )}

      {/* Seller Action Bar — Condition #5: clear CTA, no ambiguity */}
      {hasSellerActionBar && (
        <div className="fixed bottom-[env(safe-area-inset-bottom)] left-0 right-0 z-[60] bg-background/80 backdrop-blur-xl border-t border-border/50">
          <div className="px-4 py-3 flex gap-3">
            {o.canSellerReject && <Button variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground h-12" onClick={() => o.setIsRejectionDialogOpen(true)} disabled={o.isUpdating}><XCircle size={16} className="mr-1.5" />Reject</Button>}
            {!o.nextStatus ? (
              o.isUpdating ? (
                <div className="flex-1 flex items-center justify-center gap-2 h-12 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span>Updating…</span>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center gap-2 h-12 text-sm text-muted-foreground">
                  <Check size={14} className="text-primary" />
                  <span>{getSellerContextMessage() || 'Waiting for next step…'}</span>
                </div>
              )
            ) : (() => {
              // OTP requirement is driven entirely by the workflow editor (category_status_flows.otp_type).
              // No hardcoded fallbacks — if the workflow says no OTP, no OTP is shown.
              const nextOtpType = getStepOtpType(o.flow, o.nextStatus);
              const isPlatformDelivery = (order as any).delivery_handled_by === 'platform';
              const needsDeliveryOtp = nextOtpType === 'delivery' && !!deliveryAssignmentId && isPlatformDelivery;
              const needsGenericOtp = nextOtpType === 'generic' || (nextOtpType === 'delivery' && !isPlatformDelivery);

              return needsDeliveryOtp ? (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => setIsOtpDialogOpen(true)} disabled={o.isUpdating}>
                  {o.isUpdating ? 'Updating...' : getActionLabel(o.nextStatus!, true)}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              ) : needsGenericOtp ? (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => { setGenericOtpTargetStatus(o.nextStatus!); setIsGenericOtpDialogOpen(true); }} disabled={o.isUpdating}>
                  {o.isUpdating ? 'Updating...' : getActionLabel(o.nextStatus!, true)}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              ) : (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => o.updateOrderStatus(o.nextStatus!)} disabled={o.isUpdating}>{o.isUpdating ? 'Updating...' : getActionLabel(o.nextStatus!, false)}<ChevronRight size={14} className="ml-1" /></Button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Buyer Action Bar */}
      {hasBuyerActionBar && (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[60] bg-background/80 backdrop-blur-xl border-t border-border/50">
          <div className="px-4 py-3 flex gap-3">
            {serviceBooking ? (
              <>
                {o.canBuyerCancel && (
                  <BuyerCancelBooking
                    bookingId={serviceBooking.id}
                    orderId={order.id}
                    slotId={serviceBooking.slot_id}
                    status={serviceBooking.status}
                  />
                )}
                <BuyerRescheduleBooking
                  bookingId={serviceBooking.id}
                  orderId={order.id}
                  productId={serviceBooking.product_id}
                  sellerId={serviceBooking.seller_id}
                  status={serviceBooking.status}
                  currentDate={serviceBooking.booking_date}
                  currentStartTime={serviceBooking.start_time}
                />
              </>
            ) : (
              o.canBuyerCancel && (
                <OrderCancellation orderId={order.id} orderStatus={order.status} onCancelled={() => o.fetchOrder()} canCancel={true} />
              )
            )}
            {o.buyerNextStatus && (() => {
              // Buyer OTP requirements are driven entirely by the workflow editor — no hardcoded fallbacks.
              const buyerNextOtpType = getStepOtpType(o.flow, o.buyerNextStatus);
              const buyerNeedsDeliveryOtp = buyerNextOtpType === 'delivery' && !!deliveryAssignmentId;
              const buyerNeedsGenericOtp = buyerNextOtpType === 'generic';
              return buyerNeedsDeliveryOtp ? (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => setIsOtpDialogOpen(true)} disabled={o.isUpdating}>
                  {o.isUpdating ? 'Updating...' : getActionLabel(o.buyerNextStatus!, true)}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              ) : buyerNeedsGenericOtp ? (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => { setGenericOtpTargetStatus(o.buyerNextStatus!); setIsGenericOtpDialogOpen(true); }} disabled={o.isUpdating}>
                  {o.isUpdating ? 'Updating...' : getActionLabel(o.buyerNextStatus!, true)}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              ) : (
                <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 h-12" onClick={() => o.buyerAdvanceOrder(o.buyerNextStatus!)} disabled={o.isUpdating}>
                  {o.isUpdating ? 'Updating...' : getActionLabel(o.buyerNextStatus!, false)}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              );
            })()}
          </div>
        </div>
      )}

      <OrderRejectionDialog open={o.isRejectionDialogOpen} onOpenChange={o.setIsRejectionDialogOpen} onReject={o.handleReject} orderNumber={order.id} />
      {o.chatRecipientId && <OrderChat orderId={order.id} otherUserId={o.chatRecipientId} otherUserName={o.chatRecipientName || 'User'} isOpen={o.isChatOpen} onClose={() => { o.setIsChatOpen(false); o.fetchUnreadCount(); }} disabled={!o.canChat} />}

      <DeliveryCompletionOtpDialog
        orderId={order.id}
        open={isOtpDialogOpen}
        onOpenChange={setIsOtpDialogOpen}
        onVerified={() => o.fetchOrder()}
      />

      {genericOtpTargetStatus && (
        <GenericOtpDialog
          orderId={order.id}
          targetStatus={genericOtpTargetStatus}
          open={isGenericOtpDialogOpen}
          onOpenChange={setIsGenericOtpDialogOpen}
          onVerified={() => o.fetchOrder()}
        />
      )}

      {showArrivalOverlay && (
        <DeliveryArrivalOverlay
          distance={deliveryTracking.distance}
          eta={deliveryTracking.distance != null && deliveryTracking.distance < 500 ? Math.max(1, Math.ceil(deliveryTracking.distance / 1000 * 4)) : (roadEtaMinutes ?? deliveryTracking.eta)}
          riderName={deliveryTracking.riderName}
          riderPhone={deliveryTracking.riderPhone}
          status={deliveryTracking.status}
          onDismiss={() => {}}
          deliveryCode={buyerOtp}
          transitStatuses={trackingConfig.transit_statuses}
          overlayDistanceMeters={trackingConfig.arrival_overlay_distance_meters}
          doorstepDistanceMeters={trackingConfig.arrival_doorstep_distance_meters}
          proximityMessages={(() => {
            try {
              const raw = getSetting('proximity_thresholds');
              if (raw) {
                const cfg = JSON.parse(raw);
                return {
                  at_doorstep_title: cfg.at_doorstep?.buyer_message,
                  arriving_title: cfg.arriving?.buyer_message,
                  subtitle: undefined,
                };
              }
            } catch { /* use defaults */ }
            return undefined;
          })()}
        />
      )}
    </AppLayout>
  );
}

/** Seller-side refund section — fetches refund for this order and shows action buttons */
function SellerRefundSection({ orderId, onAction }: { orderId: string; onAction: () => void }) {
  const [refund, setRefund] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function fetchRefund() {
    const { data } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1);
    setRefund(data?.[0] || null);
    setLoading(false);
  }

  useEffect(() => {
    fetchRefund();
    // Realtime updates so seller card reflects buyer requests + state changes instantly
    const channel = supabase
      .channel(`seller-refund-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'refund_requests', filter: `order_id=eq.${orderId}` },
        () => { fetchRefund(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (loading || !refund) return null;

  return (
    <SellerRefundActions
      refundId={refund.id}
      refundStatus={refund.refund_state || refund.status}
      refundAmount={refund.amount}
      refundReason={refund.reason}
      refundCategory={refund.category}
      createdAt={refund.created_at}
      evidenceUrls={refund.evidence_urls || []}
      onActionComplete={() => { fetchRefund(); onAction(); }}
    />
  );
}
