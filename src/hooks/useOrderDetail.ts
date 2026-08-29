// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { useUrgentOrderSound } from '@/hooks/useUrgentOrderSound';
import { useCurrency } from '@/hooks/useCurrency';
import { useCategoryStatusFlow, getNextStatusForActor, getTimelineSteps, isTerminalStatus, isSuccessfulTerminal, isFirstFlowStep, canActorCancel, useStatusTransitions } from '@/hooks/useCategoryStatusFlow';
import { isDeliveryMapEligible } from '@/lib/orderProgressStages';
import { logAudit } from '@/lib/audit';
import { resolveTransactionType } from '@/lib/resolveTransactionType';
import {
  canBuyerCancelScheduled,
  isScheduledFulfillmentLocked,
  isScheduledFulfillmentStatus,
  isScheduledOrder,
  isUpcomingScheduled,
} from '@/lib/scheduled-orders';
import { isOrderAcceptanceExpired } from '@/lib/expired-order-acks';
import { Order, OrderStatus } from '@/types/Database';
import { toast } from 'sonner';
import { showFeedback } from '@/components/FeedbackPopupProvider';

async function fetchOrderData(id: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, seller:seller_profiles(id, business_name, user_id, primary_group, latitude, longitude, delivery_radius_km, profile:profiles!seller_profiles_user_id_fkey(name, phone, block, flat_number)), buyer:profiles!orders_buyer_id_fkey(name, phone, block, flat_number, phase, society_id), items:order_items(*, product:products(category, listing_type))`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const societyId = (data as any).society_id || (data as any).buyer?.society_id;
  if (societyId) {
    const { data: society } = await supabase.from('societies').select('name').eq('id', societyId).maybeSingle();
    (data as any).buyer_society_name = society?.name || null;
  }

  // Derive parent_group inline from the first item's product category
  let parentGroup: string | null = null;
  let listingType: string | null = null;
  const sellerPg = (data as any)?.seller?.primary_group;
  const firstItem = (data as any)?.items?.[0];
  const product = firstItem?.product;

  if (product) {
    listingType = product.listing_type || null;
    if (!sellerPg && product.category) {
      const { data: catConfig } = await supabase
        .from('category_config')
        .select('parent_group')
        .eq('category', product.category as any)
        .maybeSingle();
      parentGroup = catConfig?.parent_group || null;
    }
  }

  return { order: data as any, derivedParentGroup: parentGroup, derivedListingType: listingType };
}

export function useOrderDetail(id: string | undefined) {
  const { user, isSeller, sellerProfiles, currentSellerId } = useAuth();
  const { getOrderStatus, getPaymentStatus, getItemStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isRejectionDialogOpen, setIsRejectionDialogOpen] = useState(false);

  // Main order query with React Query caching
  const { data: orderData, isLoading } = useQuery({
    queryKey: ['order-detail', id],
    queryFn: () => fetchOrderData(id!),
    enabled: !!id,
    staleTime: 2 * 60_000,
  });

  const order = orderData?.order as Order | null ?? null;
  const derivedParentGroup = orderData?.derivedParentGroup ?? null;
  const derivedListingType = orderData?.derivedListingType ?? null;

  // Review check as separate cached query
  const { data: hasReviewData } = useQuery({
    queryKey: ['order-review', id],
    queryFn: async () => {
      const { data } = await supabase.from('reviews').select('id').eq('order_id', id!).maybeSingle();
      return !!data;
    },
    enabled: !!id && !!order,
    staleTime: 5 * 60_000,
  });
  const hasReview = hasReviewData ?? false;

  const seller = (order as any)?.seller;

  const isSellerView = useMemo(() => {
    if (!order || !user) return false;
    const orderSellerId = order.seller_id;
    if (!orderSellerId) return false;
    if (currentSellerId && orderSellerId === currentSellerId) return true;
    if (sellerProfiles.some(sp => sp.id === orderSellerId)) return true;
    if (seller?.user_id === user.id) return true;
    return false;
  }, [order?.seller_id, user?.id, currentSellerId, sellerProfiles, seller?.user_id]);

  const hasAutoCancelAt = !!order?.auto_cancel_at;
  const sellerPrimaryGroup = seller?.primary_group;
  const orderType = (order as any)?.order_type;

  const effectiveParentGroup = sellerPrimaryGroup || derivedParentGroup;
  const resolvedParentGroup = effectiveParentGroup || 'default';
  const isEnquiryOrder = (order as any)?.order_type === 'enquiry';
  const orderFulfillmentType = (order as any)?.fulfillment_type || null;
  const deliveryHandledBy = (order as any)?.delivery_handled_by || null;
  const storedTransactionType = (order as any)?.transaction_type || null;
  const { flow, isLoading: isFlowLoading } = useCategoryStatusFlow(effectiveParentGroup, orderType, orderFulfillmentType, deliveryHandledBy, derivedListingType, storedTransactionType);

  // Timer-based tick to re-evaluate urgency when auto_cancel_at passes
  const [urgencyTick, setUrgencyTick] = useState(0);
  useEffect(() => {
    if (!order?.auto_cancel_at) return;
    const msLeft = new Date(order.auto_cancel_at).getTime() - Date.now();
    if (msLeft <= 0) { setUrgencyTick(t => t + 1); return; }
    const timer = setTimeout(() => setUrgencyTick(t => t + 1), msLeft + 500);
    return () => clearTimeout(timer);
  }, [order?.auto_cancel_at]);

  const isUrgentOrder = useMemo(() => {
    if (!hasAutoCancelAt || !order?.status || !order?.auto_cancel_at) return false;
    if (!isFirstFlowStep(flow, order.status)) return false;
    return new Date(order.auto_cancel_at).getTime() > Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutoCancelAt, order?.status, order?.auto_cancel_at, flow, urgencyTick]);

  /** Seller response window already passed — Accept must be blocked (server also enforces). */
  const isAcceptanceExpired = useMemo(() => {
    return isOrderAcceptanceExpired(order?.auto_cancel_at, order?.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.auto_cancel_at, order?.status, urgencyTick]);

  const isUrgentSellerView = isUrgentOrder && isSellerView;
  const isUrgentBuyerView = isUrgentOrder && !isSellerView;

  useUrgentOrderSound(!!isUrgentSellerView);

  const resolvedTxnType = useMemo(
    () => resolveTransactionType(effectiveParentGroup || 'default', orderType, orderFulfillmentType, deliveryHandledBy, derivedListingType, storedTransactionType),
    [effectiveParentGroup, orderType, orderFulfillmentType, deliveryHandledBy, derivedListingType, storedTransactionType]
  );
  const transitions = useStatusTransitions(effectiveParentGroup || 'default', resolvedTxnType);

  const timelineSteps = useMemo(() => getTimelineSteps(flow, order?.status), [flow, order?.status]);

  const statusOrder = useMemo(() => {
    if (flow.length > 0) return flow.map(s => s.status_key as OrderStatus);
    return [] as OrderStatus[];
  }, [flow]);

  const currentStatusIndex = order ? statusOrder.indexOf(order.status) : -1;

  const getNextStatus = (): OrderStatus | null => {
    if (!order) return null;
    if (isTerminalStatus(flow, order.status)) return null;
    if (flow.length > 0) {
      // seller_advance_order only accepts seller-allowed edges.
      // Seller-as-courier uses seller_delivery transitions (allowed_actor=seller), not delivery actor.
      const next = getNextStatusForActor(flow, order.status, 'seller', transitions);
      return next as OrderStatus | null;
    }
    // Defensive fallback: flow rows missing but transitions exist (half-configured workflow).
    // Use transitions directly so the seller "Accept Order" CTA still works.
    if (transitions.length > 0) {
      const primary = transitions.filter(t => !t.is_side_action && t.allowed_actor === 'seller' && t.from_status === order.status && t.to_status !== 'cancelled');
      if (primary.length > 0) return primary[0].to_status as OrderStatus;
    }
    return null;
  };

  const buyerNextStatus = useMemo((): OrderStatus | null => {
    if (!order || isTerminalStatus(flow, order.status)) return null;
    if (flow.length === 0 || transitions.length === 0) return null;
    const next = getNextStatusForActor(flow, order.status, 'buyer', transitions);
    return next as OrderStatus | null;
  }, [order?.status, flow, transitions]);

  const canSellerReject = useMemo(() => {
    if (!order || !isSellerView) return false;
    return canActorCancel(transitions, order.status, 'seller');
  }, [order?.status, isSellerView, transitions]);

  const canBuyerCancel = useMemo(() => {
    if (!order) return false;
    if (!canActorCancel(transitions, order.status, 'buyer')) return false;
    if (isScheduledOrder(order)) return canBuyerCancelScheduled(order);
    return true;
  }, [order, transitions]);

  const isScheduledAwaitingPrep = useMemo(() => {
    if (!order || !isScheduledOrder(order)) return false;
    return isScheduledFulfillmentLocked(order);
  }, [order]);

  // Invalidate cache helper
  const invalidateOrder = () => {
    queryClient.invalidateQueries({ queryKey: ['order-detail', id] });
    queryClient.invalidateQueries({ queryKey: ['order-review', id] });
  };

  /** Keep seller dashboard board / money widgets ≤5s fresh after local status changes. */
  const invalidateSellerDashboardCaches = (sellerId?: string | null) => {
    const sid = sellerId || order?.seller_id;
    const keys = [
      'seller-orders',
      'seller-dashboard-stats',
      'seller-order-filter-counts',
      'seller-analytics-charts',
      'seller-reliability',
      'seller-refund-requests',
      'seller-customers',
    ] as const;
    for (const key of keys) {
      if (sid) queryClient.invalidateQueries({ queryKey: [key, sid] });
      else queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  // Realtime subscription — invalidates cache instead of manual fetch
  useEffect(() => {
    if (!id) return;
    const channel = supabase.channel(`order-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, () => {
        invalidateOrder();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Custom events that should trigger refetch
  useEffect(() => {
    const onRefetch = () => invalidateOrder();
    window.addEventListener('order-detail-refetch', onRefetch);
    window.addEventListener('order-terminal-push', onRefetch);
    return () => {
      window.removeEventListener('order-detail-refetch', onRefetch);
      window.removeEventListener('order-terminal-push', onRefetch);
    };
  }, [id]);

  // Heartbeat polling only for active orders — sparse safety net (realtime is primary).
  // Capped at 20 beats (~30 min) to avoid indefinite polling on stuck payment_pending orders.
  useEffect(() => {
    if (!id || !order || isTerminalStatus(flow, order.status)) return;
    let beats = 0;
    const interval = window.setInterval(() => {
      beats++;
      if (beats > 20) { window.clearInterval(interval); return; }
      invalidateOrder();
    }, 90_000);
    return () => window.clearInterval(interval);
  }, [id, order?.status, flow]);

  const fetchUnreadCount = async () => {
    if (!user || !id) return;
    const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('order_id', id).eq('receiver_id', user.id).eq('read_status', false);
    setUnreadMessages(count || 0);
  };

  // Fetch unread on mount + visibility
  useEffect(() => {
    if (id && user) fetchUnreadCount();
  }, [id, user?.id]);

  // Keep unreadMessages fresh while chat sheet is closed (INSERT/UPDATE for this order)
  useEffect(() => {
    if (!id || !user?.id) return;
    const channel = supabase
      .channel(`order-chat-unread-${id}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `order_id=eq.${id}`,
        },
        (payload) => {
          const msg: any = payload.new;
          if (msg?.receiver_id === user.id) fetchUnreadCount();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `order_id=eq.${id}`,
        },
        (payload) => {
          const msg: any = payload.new;
          if (msg?.receiver_id === user.id) fetchUnreadCount();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, user?.id]);

  // Legacy fetchOrder for optimistic update reconciliation
  const fetchOrder = async () => { invalidateOrder(); };

  const buyerAdvanceOrder = async (newStatus: OrderStatus) => {
    if (!order || !user) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('buyer_advance_order', {
        _order_id: order.id,
        _new_status: newStatus,
      });
      if (error) throw error;
      // Optimistic update — immediately reflect in UI
      queryClient.setQueryData(['order-detail', id], (old: any) =>
        old ? { ...old, order: { ...old.order, status: newStatus } } : old
      );
      // Release button BEFORE background refetch
      setIsUpdating(false);
      queryClient.invalidateQueries({ queryKey: ['order-detail', id] });
      supabase.functions.invoke('process-notification-queue').catch(() => {});
      if (order.society_id) logAudit(`order_${newStatus}`, 'order', order.id, order.society_id, { old_status: order.status, new_status: newStatus });
    } catch (error: any) {
      console.error('Buyer advance order failed:', error);
      const errMsg = error?.message || error?.details || '';
      toast.error(errMsg.includes('Invalid buyer transition') ? 'This action is no longer available' : errMsg.includes('notification_queue') ? 'Order updated, but seller notification failed. Retrying in the background.' : 'Could not update this order. Pull to refresh, or try again in a minute.', { id: `order-${order.id}-error` });
      invalidateOrder();
      setIsUpdating(false);
    }
  };

  const updateOrderStatus = async (newStatus: OrderStatus, rejectionReason?: string) => {
    if (!order || !user) return;
    if (
      isSellerView &&
      isAcceptanceExpired &&
      ['accepted', 'confirmed', 'scheduled', 'preparing'].includes(newStatus)
    ) {
      toast.error('Response time expired — this order can no longer be accepted', {
        id: `order-${order.id}-expired`,
      });
      invalidateOrder();
      return;
    }
    setIsUpdating(true);
    try {
      let confirmedStatus: OrderStatus = newStatus;
      if (isSellerView) {
        const { data, error } = await supabase.rpc('seller_advance_order', {
          _order_id: order.id,
          _new_status: newStatus,
          _rejection_reason: rejectionReason || null,
        });
        if (error) throw error;
        // Prefer server-confirmed status — do not optimistic-succeed without RPC confirmation
        if (!data) {
          throw new Error('Order status was not updated — refresh and retry');
        }
        confirmedStatus = data as OrderStatus;
      } else {
        const { error } = await supabase.rpc('buyer_advance_order', {
          _order_id: order.id,
          _new_status: newStatus,
        });
        if (error) throw error;
      }

      queryClient.setQueryData(['order-detail', id], (old: any) =>
        old ? { ...old, order: { ...old.order, status: confirmedStatus, rejection_reason: rejectionReason || old.order?.rejection_reason } } : old
      );
      setIsUpdating(false);
      queryClient.invalidateQueries({ queryKey: ['order-detail', id] });
      if (isSellerView) invalidateSellerDashboardCaches(order.seller_id);
      supabase.functions.invoke('process-notification-queue').catch(() => {});
      if (order.society_id) logAudit(`order_${confirmedStatus}`, 'order', order.id, order.society_id, { old_status: order.status, new_status: confirmedStatus, rejection_reason: rejectionReason });
    } catch (error: any) {
      console.error('Error updating order:', error, JSON.stringify(error));
      const errMsg = error?.message || error?.details || '';

      if (errMsg.includes('Delivery OTP verification required') || errMsg.includes('otp')) {
        window.dispatchEvent(new CustomEvent('delivery-otp-required', { detail: { orderId: order.id } }));
        toast.info('OTP verification required — please enter the delivery code', { id: `order-${order.id}-otp` });
      } else if (/response time expired|can no longer be accepted/i.test(errMsg)) {
        toast.error('Response time expired — this order can no longer be accepted', { id: `order-${order.id}-expired` });
        invalidateOrder();
      } else {
        toast.error(
          errMsg.includes('Invalid seller transition') || errMsg.includes('Invalid status transition')
            ? (errMsg || 'This status change is not allowed for your role or workflow')
            : errMsg.includes('Not authorized')
              ? 'You are not authorized to perform this action'
              : errMsg.includes('concurrently') || errMsg.includes('40001')
                ? 'Order changed — refresh and try again'
                : errMsg.includes('notification_queue')
                  ? 'Order updated, but notification delivery failed. Retrying in the background.'
                  : `Failed to update order: ${errMsg || 'Unknown error'}`,
          { id: `order-${order.id}-error` }
        );
      }
      invalidateOrder();
      setIsUpdating(false);
    }
  };

  const handleReject = async (reason: string) => { await updateOrderStatus('cancelled', reason); };
  const handleTimeout = () => {
    // Server expires the order by id at auto_cancel_at (edge waitUntil +
    // one-shot cron). Client cannot cancel; refresh until status updates.
    invalidateOrder();
    setTimeout(() => invalidateOrder(), 1500);
    setTimeout(() => invalidateOrder(), 4000);
    setTimeout(() => invalidateOrder(), 8000);
  };

  const isBuyerView = order ? order.buyer_id === user?.id : false;
  const rawNextStatus = getNextStatus();
  const nextStatus =
    isScheduledAwaitingPrep && rawNextStatus && isScheduledFulfillmentStatus(rawNextStatus)
      ? null
      : rawNextStatus;
  const canReview = isBuyerView && order ? isSuccessfulTerminal(flow, order.status) && !hasReview : false;
  const canChat = order ? !isTerminalStatus(flow, order.status) : false;
  const canReorder = isBuyerView && order ? isSuccessfulTerminal(flow, order.status) : false;
  let chatRecipientId = isSellerView ? order?.buyer_id : seller?.user_id;
  let chatRecipientName = isSellerView ? (order as any)?.buyer?.name : seller?.business_name;
  if (chatRecipientId && user?.id && chatRecipientId === user.id) {
    chatRecipientId = isSellerView ? seller?.user_id : order?.buyer_id;
    chatRecipientName = isSellerView ? seller?.business_name : (order as any)?.buyer?.name;
  }

  const copyOrderId = () => { if (!order) return; navigator.clipboard.writeText(order.id.slice(0, 8)); showFeedback({ title: 'Order ID copied', variant: 'success' }); };

  const displayStatuses = useMemo(() => {
    if (timelineSteps.length === 0) return [];
    const steps = timelineSteps.map(s => s.status_key);
    if (steps.includes('delivered') && steps.includes('completed')) {
      const deliveredStep = timelineSteps.find(s => s.status_key === 'delivered');
      if (deliveredStep?.is_terminal) {
        return steps.filter(s => s !== 'completed');
      }
    }
    return steps;
  }, [timelineSteps]);

  const getFlowStepLabel = (statusKey: string, role?: 'buyer' | 'seller'): { label: string; color: string } => {
    const step = flow.find(s => s.status_key === statusKey);
    if (step) {
      const label = (role === 'buyer' && step.buyer_display_label)
        ? step.buyer_display_label
        : (role === 'seller' && step.seller_display_label)
          ? step.seller_display_label
          : step.display_label;
      if (label) return { label, color: step.color || 'bg-gray-100 text-gray-600' };
    }
    return getOrderStatus(statusKey);
  };

  const getBuyerHint = (statusKey: string): string | null => {
    const step = flow.find(s => s.status_key === statusKey);
    return step?.buyer_hint || null;
  };

  const getSellerHint = (statusKey: string): string | null => {
    const step = flow.find(s => s.status_key === statusKey);
    return (step as any)?.seller_hint || null;
  };

  const isInTransit = useMemo(() => {
    if (!order) return false;
    const step = flow.find(s => s.status_key === order.status);
    // Align with shared progress stage 3: true transit only (never ready/assigned)
    return isDeliveryMapEligible(order.status, step?.is_transit === true);
  }, [order?.status, flow]);

  const currentStepActor = useMemo(() => {
    if (!order) return '';
    const step = flow.find(s => s.status_key === order.status);
    return step?.actor || '';
  }, [order?.status, flow]);

  // Provide setOrder and setHasReview as no-ops for backward compat
  const setOrder = (o: any) => {
    if (o && id) {
      queryClient.setQueryData(['order-detail', id], (old: any) =>
        old ? { ...old, order: o } : { order: o, derivedParentGroup: null, derivedListingType: null }
      );
    }
  };
  const setHasReview = (v: boolean) => {
    if (id) queryClient.setQueryData(['order-review', id], v);
  };

  return {
    order, setOrder, isLoading, isUpdating, hasReview, setHasReview,
    isChatOpen, setIsChatOpen, unreadMessages, fetchUnreadCount,
    isRejectionDialogOpen, setIsRejectionDialogOpen,
    seller, isSellerView, isUrgentOrder, isUrgentSellerView, isUrgentBuyerView, isBuyerView, isEnquiryOrder,
    isAcceptanceExpired,
    nextStatus, buyerNextStatus, canReview, canChat, canReorder,
    canSellerReject, canBuyerCancel, isScheduledAwaitingPrep, isInTransit, isFlowLoading,
    currentStepActor, resolvedTxnType, resolvedParentGroup,
    chatRecipientId, chatRecipientName,
    orderFulfillmentType, currentStatusIndex, statusOrder,
    displayStatuses, timelineSteps, flow,
    getOrderStatus, getPaymentStatus, getItemStatus,
    getFlowStepLabel, getBuyerHint, getSellerHint,
    formatPrice, user,
    updateOrderStatus, buyerAdvanceOrder, handleReject, handleTimeout, copyOrderId, fetchOrder,
    transitions,
  };
}
