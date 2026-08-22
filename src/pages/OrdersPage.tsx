// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
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
import { useOrdersList } from '@/hooks/useOrdersList';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';
import { useCurrency } from '@/hooks/useCurrency';
import { Order } from '@/types/Database';
import { Package, ChevronRight, Loader2, CheckCircle, Truck, MessageCircle } from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday, differenceInDays } from 'date-fns';
import { staggerContainer, cardEntrance, emptyState, fadeSlideUp } from '@/lib/motion-variants';
import { ALL_STORES_ID, isPortfolioSellerId, resolveOperationalSellerId } from '@/lib/seller-order-board';
import { resolveOrderProgress } from '@/lib/orderProgressStages';
import { groupBuyerOrdersForList } from '@/lib/checkout-groups';
import { BuyerUpcomingOrders } from '@/components/orders/BuyerUpcomingOrders';
import { ScheduledOrderCountdown } from '@/components/orders/ScheduledOrderCountdown';
import { isScheduledOrder, isUpcomingScheduled } from '@/lib/scheduled-orders';

function humanizeTime(iso: string): string {
  const d = new Date(iso);
  const days = differenceInDays(new Date(), d);
  if (days < 1) return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return 'Yesterday';
  if (days < 7) return format(d, 'EEEE');
  return format(d, 'MMM d');
}

function OrderCard({ order, type, successTerminals, unreadCounts }: { order: Order; type: 'buyer' | 'seller'; successTerminals: Set<string>; unreadCounts?: Map<string, number> }) {
  const { getFlowLabel } = useFlowStepLabels();
  const { formatPrice } = useCurrency();
  const statusInfo = getFlowLabel(order.status, type);
  const seller = (order as any).seller;
  const buyer = (order as any).buyer;
  const items = (order as any).items || [];
  const canReorder = type === 'buyer' && successTerminals.has(order.status);
  const isCompleted = successTerminals.has(order.status);
  const unread = unreadCounts?.get(order.id) || 0;
  const isUpcomingScheduledOrder = isScheduledOrder(order as any) && isUpcomingScheduled(order as any);
  const isActive = !isCompleted && !['cancelled', 'rejected'].includes(order.status) && !isUpcomingScheduledOrder;
  const progress = resolveOrderProgress({
    status: order.status,
    fulfillmentType: (order as any).fulfillment_type,
  }).progressPercent || (isActive ? 30 : 0);
  const firstItem = items[0];
  const itemImage = (firstItem as any)?.product_image || seller?.cover_image_url;
  // Pull dot color from statusInfo.color (e.g. "bg-yellow-100 text-yellow-700")
  const dotColor = (statusInfo.color || '').split(' ').find((c: string) => c.startsWith('text-')) || 'text-muted-foreground';

  return (
    <Link to={`/orders/${order.id}`} className="block">
      <motion.div
        whileTap={{ scale: 0.985 }}
        whileHover={{ y: -1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className="relative overflow-hidden bg-card/80 backdrop-blur-lg border border-border/50 rounded-2xl mb-2.5 shadow-[0_2px_10px_-6px_hsl(var(--foreground)/0.08)] hover:shadow-[0_4px_18px_-8px_hsl(var(--foreground)/0.16)] transition-shadow"
      >
        <div className="p-3 flex items-start gap-3">
          {/* Thumbnail 56x56 */}
          <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-muted border border-border/60">
            {itemImage ? (
              <img src={itemImage} alt={firstItem?.product_name || seller?.business_name} className="w-full h-full object-cover" loading="lazy" />
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
                  {type === 'buyer' ? (seller?.business_name || 'Seller') : (buyer?.name || 'Customer')}
                </h3>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  #{order.id.slice(0, 8)}
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
                {statusInfo.label}
              </span>
              {['delivery', 'seller_delivery'].includes((order as any).fulfillment_type) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-0.5">
                  <Truck size={9} /> Delivery
                </span>
              )}
              {(order as any).payment_type && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                  {(order as any).payment_type === 'cod' ? 'COD' : (order as any).payment_type === 'card' ? 'Online ✓' : 'UPI ✓'}
                </span>
              )}
              {isUpcomingScheduledOrder && (
                <ScheduledOrderCountdown order={order as any} size="sm" />
              )}
              <span className="text-[11px] text-muted-foreground ml-auto">
                {humanizeTime(order.created_at)}
              </span>
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {items.length} item{items.length > 1 ? 's' : ''} · <span className="font-semibold text-foreground">{formatPrice(order.total_amount)}</span>
            </p>

            {type === 'seller' && buyer && (
              <p className="text-[11px] text-muted-foreground">
                Block {buyer.block}, {buyer.flat_number}
              </p>
            )}
          </div>
        </div>

        {/* Active order progress bar */}
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
            <ReorderButton orderItems={items} sellerId={order.seller_id} variant="outline" size="sm" />
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

function OrderList({ type, userId, sellerId }: { type: 'buyer' | 'seller'; userId: string; sellerId?: string }) {
  const [buyerFilter, setBuyerFilter] = useState<'all' | 'active' | 'upcoming' | 'completed' | 'cancelled'>('all');
  const listFilter = buyerFilter === 'upcoming' ? 'all' : buyerFilter;
  const { orders, isLoading, hasMore, isLoadingMore, loadMore, successSet } = useOrdersList(type, userId, sellerId, listFilter);
  const queryClient = useQueryClient();

  // Fetch unread chat message counts per order
  const orderIds = orders.map(o => o.id);
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

  // Lightweight realtime: refresh unread badges when messages arrive/are read for this user
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

  const visibleOrders = buyerFilter === 'active'
    ? orders.filter(o => !isUpcomingScheduled(o as any))
    : orders;

  if (visibleOrders.length === 0 && buyerFilter === 'all') {
    return <EmptyState message={type === 'buyer' ? "You haven't placed any orders yet" : "No orders received yet"} type={type} />;
  }

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
      {visibleOrders.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 text-sm text-muted-foreground"
        >
          No {buyerFilter} orders
        </motion.div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          key={buyerFilter}
        >
          {type === 'buyer'
            ? groupBuyerOrdersForList(visibleOrders as any).map((item) => (
                <motion.div
                  key={item.kind === 'group' ? item.groupId : item.order.id}
                  variants={cardEntrance}
                >
                  {item.kind === 'group' ? (
                    <CheckoutGroupCard groupId={item.groupId} orders={item.orders} />
                  ) : (
                    <OrderCard
                      order={item.order as any}
                      type={type}
                      successTerminals={successSet}
                      unreadCounts={unreadCounts}
                    />
                  )}
                </motion.div>
              ))
            : visibleOrders.map((order) => (
                <motion.div key={order.id} variants={cardEntrance}>
                  <OrderCard
                    order={order}
                    type={type}
                    successTerminals={successSet}
                    unreadCounts={unreadCounts}
                  />
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
  const fromSellerNotification = (location.state as any)?.tab === 'selling';
  const defaultTab = isSeller && fromSellerNotification ? 'selling' : 'buying';
  const operationalSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles || []);
  const portfolioMode = isPortfolioSellerId(currentSellerId);

  if (!user) return null;

  return (
    <AppLayout headerTitle="Orders">
      <div className="pb-4">
        <div className="px-4 pt-3">
          {isSeller ? (
            <Tabs defaultValue={defaultTab} className="w-full">
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
                <OrderList type="buyer" userId={user.id} />
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
                      portfolio board for summed action-needed &amp; settled GMV.
                    </p>
                  </div>
                ) : (
                  <OrderList type="seller" userId={user.id} sellerId={operationalSellerId || undefined} />
                )}
                {portfolioMode && (
                  <OrderList type="seller" userId={user.id} sellerId={ALL_STORES_ID} />
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
              <OrderList type="buyer" userId={user.id} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
