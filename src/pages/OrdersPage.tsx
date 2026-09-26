// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { ReviewPromptBanner } from '@/components/order/ReviewPromptBanner';
import { LoyaltyCard } from '@/components/loyalty/LoyaltyCard';
import { WalletCard } from '@/components/wallet/WalletCard';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReorderButton } from '@/components/order/ReorderButton';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import { RecurringBookingsList } from '@/components/booking/RecurringBookingsList';
import { BuyerBookingsCalendar } from '@/components/booking/BuyerBookingsCalendar';
import { SafeSectionWrapper } from '@/components/SafeSectionWrapper';
import { useAuth } from '@/contexts/AuthContext';
import { useBuyerRealtimeShell } from '@/hooks/useBuyerRealtimeShell';
import { deriveDisplayStatus } from '@/lib/deriveDisplayStatus';
import { useOrdersList } from '@/hooks/useOrdersList';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';
import { useCurrency } from '@/hooks/useCurrency';
import { Order } from '@/types/Database';
import { Package, ChevronRight, Loader2, CheckCircle, Truck, MessageCircle, CalendarDays, Zap } from 'lucide-react';
import { staggerContainer, cardEntrance, emptyState } from '@/lib/motion-variants';
import { ALL_STORES_ID, isPortfolioSellerId, resolveOperationalSellerId } from '@/lib/seller-order-board';
import { resolveOrderProgress } from '@/lib/orderProgressStages';
import { groupBuyerOrdersForList } from '@/lib/checkout-groups';
import { CheckoutGroupCard } from '@/components/order/CheckoutGroupCard';
import { firstEmbed } from '@/lib/supabase-embed';
import { humanizeRelativeTime } from '@/lib/relative-time';
import { BuyerUpcomingOrders } from '@/components/orders/BuyerUpcomingOrders';
import { ScheduledOrderCountdown } from '@/components/orders/ScheduledOrderCountdown';
import { isScheduledOrder, isUpcomingScheduled } from '@/lib/scheduled-orders';
import { orderPaymentChipLabel } from '@/lib/payment-method-label';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { formatOrderItemsGlance, formatSellerOrderLocation, formatSellerWhenGlance } from '@/lib/order-glance';
import { sortOrdersByListPriority } from '@/lib/order-list-priority';
import {
  SELLER_RECEIVED_FILTER_LABELS,
  countSellerReceivedFilters,
  formatTransitAgeChip,
  matchesSellerReceivedFilter,
  type SellerReceivedFilter,
} from '@/lib/order-due-windows';

function OrderCard({
  order,
  type,
  successTerminals,
  unreadCounts,
  ordersTab,
}: {
  order: Order;
  type: 'buyer' | 'seller';
  successTerminals: Set<string>;
  unreadCounts?: Map<string, number>;
  ordersTab?: 'buying' | 'selling';
}) {
  const { getFlowLabel } = useFlowStepLabels();
  const { formatPrice } = useCurrency();
  const orderId = order?.id ? String(order.id) : '';
  const status = order?.status == null ? '' : String(order.status);
  const statusInfo = getFlowLabel(status, type);
  const seller = firstEmbed((order as any).seller);
  const buyer = firstEmbed((order as any).buyer);
  const isContactEnquiry = (order as any).transaction_type === 'contact_enquiry';
  const contactLabel = isContactEnquiry
    ? deriveDisplayStatus({
        orderStatus: status,
        flow: [],
        isBuyerView: type === 'buyer',
        transactionType: 'contact_enquiry',
        sellerName: type === 'buyer'
          ? displaySellerStoreName(seller?.business_name)
          : (buyer?.name || 'Customer'),
      }).text
    : null;
  const items = Array.isArray((order as any).items) ? (order as any).items : [];
  const canReorder = type === 'buyer' && successTerminals.has(status);
  const isCompleted = successTerminals.has(status);
  const unread = unreadCounts?.get(orderId) || 0;
  if (!orderId) return null;
  const isUpcomingScheduledOrder = isScheduledOrder(order as any) && isUpcomingScheduled(order as any);
  const isActive = !isCompleted && !['cancelled', 'rejected'].includes(status) && !isUpcomingScheduledOrder;
  const progress = resolveOrderProgress({
    status,
    fulfillmentType: (order as any).fulfillment_type,
    transactionType: (order as any).transaction_type,
  }).progressPercent || (isActive ? 30 : 0);
  const firstItem = items[0];
  const itemImage = (firstItem as any)?.product_image || seller?.cover_image_url;
  const paymentChip = orderPaymentChipLabel((order as any).payment_type, (order as any).payment_status);
  const dotColor = (statusInfo.color || '').split(' ').find((c: string) => c.startsWith('text-')) || 'text-muted-foreground';
  const sellerItemGlance = type === 'seller' ? formatOrderItemsGlance(items) : '';
  const sellerWhen = type === 'seller' ? formatSellerWhenGlance(order as any) : null;
  const sellerLocation = type === 'seller'
    ? formatSellerOrderLocation({
        delivery_address: (order as any).delivery_address,
        buyer,
      })
    : null;
  const transitAge = type === 'seller' ? formatTransitAgeChip(order as any) : null;
  const linkState = ordersTab
    ? { returnTo: `/orders?tab=${ordersTab}` }
    : undefined;

  return (
    <Link to={`/orders/${orderId}`} state={linkState} className="block">
      <motion.div
        whileTap={{ scale: 0.985 }}
        whileHover={{ y: -1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className="relative overflow-hidden bg-card/80 backdrop-blur-lg border border-border/50 rounded-2xl mb-2.5 shadow-[0_2px_10px_-6px_hsl(var(--foreground)/0.08)] hover:shadow-[0_4px_18px_-8px_hsl(var(--foreground)/0.16)] transition-shadow"
      >
        <div className="p-3 flex items-start gap-3">
          <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-muted border border-border/60">
            {itemImage ? (
              <img src={itemImage} alt={firstItem?.product_name || displaySellerStoreName(seller?.business_name)} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package size={22} className="text-muted-foreground/70" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">
                  {type === 'buyer' ? displaySellerStoreName(seller?.business_name) : (buyer?.name || 'Customer')}
                </h3>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  #{orderId.slice(0, 8)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {unread > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                    <MessageCircle size={10} /> {unread}
                  </span>
                )}
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[11px] ${dotColor}`}>
                {isCompleted ? <CheckCircle size={11} /> : <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                {contactLabel || statusInfo.label}
              </span>
              {transitAge && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    transitAge.tone === 'danger'
                      ? 'bg-destructive/15 text-destructive'
                      : transitAge.tone === 'warn'
                        ? 'bg-warning/15 text-warning'
                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {transitAge.label}
                </span>
              )}
              {['delivery', 'seller_delivery'].includes((order as any).fulfillment_type) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-0.5">
                  <Truck size={9} /> Delivery
                </span>
              )}
              {type === 'seller' && sellerWhen && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 max-w-full ${
                    sellerWhen.kind === 'preorder'
                      ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {sellerWhen.kind === 'preorder' ? <CalendarDays size={9} /> : <Zap size={9} />}
                  {sellerWhen.label}
                </span>
              )}
              {paymentChip && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                  {paymentChip}
                </span>
              )}
              {isUpcomingScheduledOrder && (
                <ScheduledOrderCountdown order={order as any} size="sm" />
              )}
              <span className="text-[11px] text-muted-foreground ml-auto">
                {humanizeRelativeTime(order.created_at)}
              </span>
            </div>

            {type === 'seller' ? (
              <>
                {sellerItemGlance ? (
                  <p className="text-xs text-foreground mt-1 line-clamp-2 leading-snug">{sellerItemGlance}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                  </p>
                )}
                {(!isContactEnquiry || sellerLocation) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {!isContactEnquiry && (
                      <span className="font-semibold text-foreground">{formatPrice(order.total_amount)}</span>
                    )}
                    {!isContactEnquiry && sellerLocation ? ' · ' : ''}
                    {sellerLocation || ''}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                {items.length} item{items.length !== 1 ? 's' : ''}
                {!isContactEnquiry && (
                  <> · <span className="font-semibold text-foreground">{formatPrice(order.total_amount)}</span></>
                )}
              </p>
            )}
          </div>
        </div>

        {isActive && (
          <div className="h-1 bg-muted/60 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="h-full bg-gradient-to-r from-primary/80 to-primary"
            />
          </div>
        )}

        {canReorder && (
          <div className="px-3 pb-3 pt-2.5 border-t border-border/60 flex justify-end" onClick={(e) => e.stopPropagation()}>
            <ReorderButton orderItems={items} orderId={orderId} sellerId={order.seller_id} variant="outline" size="sm" />
          </div>
        )}
      </motion.div>
    </Link>
  );
}

function EmptyState({ message, type }: { message: string; type?: 'buyer' | 'seller' }) {
  return (
    <motion.div
      variants={emptyState}
      initial="hidden"
      animate="show"
      className="text-center py-16"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, y: [0, -4, 0] }}
        transition={{
          scale: { type: 'spring', stiffness: 200, damping: 15, delay: 0.15 },
          opacity: { duration: 0.3, delay: 0.15 },
          y: { duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.6 },
        }}
        className="w-16 h-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center"
      >
        <Package size={28} className="text-muted-foreground" />
      </motion.div>
      <h3 className="text-base font-semibold mb-1">{message}</h3>
      {type === 'buyer' && (
        <p className="text-sm text-muted-foreground mb-4 max-w-[240px] mx-auto">
          Discover products and services from your community
        </p>
      )}
      {type === 'seller' && (
        <p className="text-xs text-muted-foreground mb-4 max-w-[220px] mx-auto">
          Share your store link with neighbors to get your first order
        </p>
      )}
      <Link to="/">
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button size="sm">
            {type === 'buyer' ? '🛒 Place your first order' : 'Browse Sellers'}
          </Button>
        </motion.div>
      </Link>
    </motion.div>
  );
}

function OrderList({
  type,
  userId,
  sellerId,
  ordersTab,
}: {
  type: 'buyer' | 'seller';
  userId: string;
  sellerId?: string;
  ordersTab?: 'buying' | 'selling';
}) {
  const [buyerFilter, setBuyerFilter] = useState<'all' | 'active' | 'upcoming' | 'completed' | 'cancelled'>('all');
  const [sellerFilter, setSellerFilter] = useState<SellerReceivedFilter>('all');
  const listFilter = buyerFilter === 'upcoming' ? 'all' : buyerFilter;
  const { orders, isLoading, hasMore, isLoadingMore, loadMore, successSet, terminalSet } = useOrdersList(type, userId, sellerId, listFilter);
  const queryClient = useQueryClient();

  const orderIds = orders.filter(Boolean).map(o => o.id).filter(Boolean);
  const { data: unreadCounts } = useQuery({
    queryKey: ['unread-chat-counts', userId, orderIds.join(',')],
    queryFn: async () => {
      if (orderIds.length === 0) return new Map<string, number>();
      const { data } = await supabase
        .from('chat_messages')
        .select('order_id')
        .in('order_id', orderIds)
        .eq('receiver_id', userId)
        .eq('read_status', false);
      const counts = new Map<string, number>();
      (data || []).forEach((m: any) => {
        counts.set(m.order_id, (counts.get(m.order_id) || 0) + 1);
      });
      return counts;
    },
    enabled: orderIds.length > 0,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`orders-unread-chat-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['unread-chat-counts', userId] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['unread-chat-counts', userId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  const sellerCounts = useMemo(
    () => (type === 'seller' ? countSellerReceivedFilters(orders as any[]) : null),
    [type, orders],
  );

  if (isLoading && buyerFilter !== 'upcoming') {
    return (
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="space-y-2.5"
      >
        {[1, 2, 3].map(i => (
          <motion.div key={i} variants={cardEntrance}>
            <Skeleton className="h-20 w-full rounded-xl" />
          </motion.div>
        ))}
      </motion.div>
    );
  }

  if (buyerFilter === 'upcoming' && type === 'buyer') {
    return (
      <div>
        <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-hide">
          {(['all', 'active', 'upcoming', 'completed', 'cancelled'] as const).map(f => (
            <motion.button
              key={f}
              onClick={() => setBuyerFilter(f)}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className={`relative px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                buyerFilter === f
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'upcoming' ? 'Upcoming' : f === 'completed' ? 'Completed' : 'Cancelled'}
            </motion.button>
          ))}
        </div>
        <BuyerUpcomingOrders buyerId={userId} />
      </div>
    );
  }

  const filteredForView = (buyerFilter === 'active'
    ? orders.filter(o => o && !isUpcomingScheduled(o as any))
    : orders
  ).filter(Boolean);

  const afterSellerFilter = type === 'seller'
    ? filteredForView.filter((o) => matchesSellerReceivedFilter(o as any, sellerFilter))
    : filteredForView;

  const visibleOrders = sortOrdersByListPriority(
    afterSellerFilter as any[],
    successSet,
    terminalSet,
  );

  if (visibleOrders.length === 0 && buyerFilter === 'all' && (type !== 'seller' || sellerFilter === 'all')) {
    return <EmptyState message={type === 'buyer' ? "You haven't placed any orders yet" : "No orders received yet"} type={type} />;
  }

  const sellerFilterKeys: SellerReceivedFilter[] = [
    'all', 'pending', 'preparing', 'in_transit', 'due_1h', 'due_2h', 'overdue', 'completed', 'cancelled',
  ];

  return (
    <div>
      {type === 'buyer' && (
        <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-hide">
          {(['all', 'active', 'upcoming', 'completed', 'cancelled'] as const).map(f => (
            <motion.button
              key={f}
              onClick={() => setBuyerFilter(f)}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className={`relative px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                buyerFilter === f
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'upcoming' ? 'Upcoming' : f === 'completed' ? 'Completed' : 'Cancelled'}
            </motion.button>
          ))}
        </div>
      )}
      {type === 'seller' && sellerCounts && (
        <>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {([
              ['pending', 'Action'],
              ['in_transit', 'Transit'],
              ['overdue', 'Overdue'],
              ['completed', 'Done'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSellerFilter(key)}
                className={`rounded-xl border px-2 py-2 text-center transition-colors ${
                  sellerFilter === key
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 bg-muted/30'
                }`}
              >
                <p className="text-sm font-semibold tabular-nums">{sellerCounts[key]}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-hide">
            {sellerFilterKeys.map((f) => {
              const count = sellerCounts[f] ?? 0;
              if (f !== 'all' && count === 0 && sellerFilter !== f && !['pending', 'in_transit', 'completed'].includes(f)) {
                return null;
              }
              return (
                <motion.button
                  key={f}
                  type="button"
                  onClick={() => setSellerFilter(f)}
                  whileTap={{ scale: 0.93 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                  className={`relative px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                    sellerFilter === f
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : f === 'overdue' && count > 0
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {SELLER_RECEIVED_FILTER_LABELS[f]}
                  <span className="ml-1 opacity-70 tabular-nums">({count})</span>
                </motion.button>
              );
            })}
          </div>
        </>
      )}
      {visibleOrders.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 text-sm text-muted-foreground"
        >
          No {type === 'seller' ? SELLER_RECEIVED_FILTER_LABELS[sellerFilter].toLowerCase() : buyerFilter} orders
        </motion.div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          key={type === 'seller' ? sellerFilter : buyerFilter}
        >
          {type === 'buyer'
            ? groupBuyerOrdersForList(visibleOrders as any, { successSet, terminalSet }).map((item) => {
                const cardKey = item.kind === 'group' ? item.groupId : item.order.id;
                const resetKey = item.kind === 'group'
                  ? item.orders.map((o) => `${o.id}:${o.status}`).join('|')
                  : `${item.order.id}:${item.order.status}`;
                return (
                <motion.div
                  key={cardKey}
                  variants={cardEntrance}
                >
                  <SafeSectionWrapper
                    name={`orders-card-${cardKey}`}
                    resetKey={resetKey}
                    fallback={
                      <div className="rounded-2xl border border-border/50 bg-muted/40 p-3 mb-2.5 text-xs text-muted-foreground">
                        This order couldn’t be shown. Other orders are unaffected.
                      </div>
                    }
                  >
                    {item.kind === 'group' ? (
                      <CheckoutGroupCard groupId={item.groupId} orders={item.orders} />
                    ) : (
                      <OrderCard
                        order={item.order as any}
                        type={type}
                        successTerminals={successSet}
                        unreadCounts={unreadCounts}
                        ordersTab={ordersTab}
                      />
                    )}
                  </SafeSectionWrapper>
                </motion.div>
                );
              })
            : visibleOrders.map((order) => (
                <motion.div key={order.id} variants={cardEntrance}>
                  <SafeSectionWrapper
                    name={`orders-card-${order.id}`}
                    resetKey={`${order.id}:${order.status}`}
                    fallback={
                      <div className="rounded-2xl border border-border/50 bg-muted/40 p-3 mb-2.5 text-xs text-muted-foreground">
                        This order couldn’t be shown. Other orders are unaffected.
                      </div>
                    }
                  >
                    <OrderCard
                      order={order}
                      type={type}
                      successTerminals={successSet}
                      unreadCounts={unreadCounts}
                      ordersTab={ordersTab}
                    />
                  </SafeSectionWrapper>
                </motion.div>
              ))}
        </motion.div>
      )}
      {hasMore && (
        <div className="flex justify-center py-4">
          <Button variant="secondary" size="default" className="w-full" onClick={() => loadMore()} disabled={isLoadingMore}>
            {isLoadingMore ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading...</> : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  useBuyerRealtimeShell();
  const { user, isSeller, currentSellerId, sellerProfiles } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const stateTab = (location.state as any)?.tab;
  const resolvedTab =
    isSeller && (tabParam === 'selling' || stateTab === 'selling')
      ? 'selling'
      : 'buying';
  const [ordersTab, setOrdersTab] = useState<'buying' | 'selling'>(resolvedTab);
  const operationalSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles || []);
  const portfolioMode = isPortfolioSellerId(currentSellerId);

  useEffect(() => {
    setOrdersTab(resolvedTab);
  }, [resolvedTab]);

  const onTabChange = (value: string) => {
    const next = value === 'selling' ? 'selling' : 'buying';
    setOrdersTab(next);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'selling') p.set('tab', 'selling');
        else p.delete('tab');
        return p;
      },
      { replace: true },
    );
  };

  if (!user) return null;

  return (
    <AppLayout headerTitle="Orders">
      <div className="pb-4">
        <div className="px-4 pt-3">
          {isSeller ? (
            <Tabs value={ordersTab} onValueChange={onTabChange} className="w-full">
              <TabsList className="w-full mb-3 h-10">
                <TabsTrigger value="buying" className="flex-1 text-xs">My Orders</TabsTrigger>
                <TabsTrigger value="selling" className="flex-1 text-xs">Received</TabsTrigger>
              </TabsList>
              <TabsContent value="buying">
                <SafeSectionWrapper name="WalletCard"><WalletCard /></SafeSectionWrapper>
                <SafeSectionWrapper name="LoyaltyCard"><LoyaltyCard /></SafeSectionWrapper>
                <SafeSectionWrapper name="ReviewPromptBanner"><ReviewPromptBanner /></SafeSectionWrapper>
                <SafeSectionWrapper name="BuyerBookingsCalendar"><BuyerBookingsCalendar /></SafeSectionWrapper>
                <SafeSectionWrapper name="RecurringBookingsList"><RecurringBookingsList /></SafeSectionWrapper>
                <OrderList type="buyer" userId={user.id} ordersTab="buying" />
              </TabsContent>
              <TabsContent value="selling">
                <div className="mb-3">
                  <SellerSwitcher />
                </div>
                {portfolioMode ? (
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm space-y-2 mb-3">
                    <p className="font-medium">All stores selected</p>
                    <p className="text-xs text-muted-foreground">
                      Pick a store here for this list, or open the{' '}
                      <Link to="/seller" className="text-primary underline underline-offset-2">
                        Seller Dashboard
                      </Link>{' '}
                      portfolio board for summed action-needed and sales.
                    </p>
                  </div>
                ) : (
                  <OrderList type="seller" userId={user.id} sellerId={operationalSellerId || undefined} ordersTab="selling" />
                )}
                {portfolioMode && (
                  <OrderList type="seller" userId={user.id} sellerId={ALL_STORES_ID} ordersTab="selling" />
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <>
              <SafeSectionWrapper name="WalletCard"><WalletCard /></SafeSectionWrapper>
              <SafeSectionWrapper name="LoyaltyCard"><LoyaltyCard /></SafeSectionWrapper>
              <SafeSectionWrapper name="ReviewPromptBanner"><ReviewPromptBanner /></SafeSectionWrapper>
              <SafeSectionWrapper name="BuyerBookingsCalendar"><BuyerBookingsCalendar /></SafeSectionWrapper>
              <SafeSectionWrapper name="RecurringBookingsList"><RecurringBookingsList /></SafeSectionWrapper>
              <OrderList type="buyer" userId={user.id} ordersTab="buying" />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
