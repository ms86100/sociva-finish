// @ts-nocheck
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { SellerProfile } from '@/types/Database';
import { Package, Loader2, CalendarDays, Wrench, BarChart3, ShoppingBag, HeadphonesIcon, Receipt, MessageCircle, ChevronRight, LayoutGrid } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { friendlyError, cn } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

// Eager: default Orders tab + chrome
import { SellerFestivalParticipation } from '@/components/seller/SellerFestivalParticipation';
import { StoreStatusCard } from '@/components/seller/StoreStatusCard';
import { PortfolioRollupStrip } from '@/components/seller/PortfolioRollupStrip';
import { SellerVisibilityChecklist } from '@/components/seller/SellerVisibilityChecklist';
import { EarningsSummary } from '@/components/seller/EarningsSummary';
import { DashboardStats } from '@/components/seller/DashboardStats';
import { OrderFilters, OrderFilter } from '@/components/seller/OrderFilters';
import { SellerOrderCard } from '@/components/seller/SellerOrderCard';
import { UpcomingScheduledPanel } from '@/components/seller/UpcomingScheduledPanel';
import { SellerScheduleView } from '@/components/seller/SellerScheduleView';
import { useSellerTickets, useSellerSupportRealtime } from '@/hooks/useSupportTickets';
import { useSellerServiceBookings } from '@/hooks/useServiceBookings';
import { AvailabilityPromptBanner } from '@/components/seller/AvailabilityPromptBanner';
import { MissingLocationBanner } from '@/components/seller/MissingLocationBanner';
import { SellerDashboardLoadingState } from '@/components/seller/SellerDashboardLoadingState';
import { useSellerOrderStats, useSellerOrdersInfinite, useSellerOrderFilterCounts } from '@/hooks/queries/useSellerOrders';
import { prefetchSellerRoutes } from '@/lib/route-prefetch';
import {
  resolveSellerFinancialIds,
  useSellerFinancialRealtime,
  useSellerFinancialSummary,
} from '@/hooks/queries/useSellerFinancial';
import { SellerTransferBanner } from '@/components/seller/SellerTransferBanner';
import { SellerActivationBanner } from '@/components/seller/SellerActivationBanner';
import { SellerJourneyBanner } from '@/components/seller/SellerJourneyBanner';
import { SocivaCreditsCard } from '@/components/seller/SocivaCreditsCard';
import { StoreCompletionCard } from '@/components/seller/StoreCompletionCard';
import { useSellerCreditActivation, useSellerCreditRealtime, useSellerCreditSummary } from '@/hooks/queries/useSellerCredits';
import { useSellerHasBookableServices } from '@/hooks/useSellerHasBookableServices';
import {
  emptyBoardCounts,
  FILTER_LABELS,
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import { motion, AnimatePresence } from 'framer-motion';
import { emptyState, listItem, staggerContainer } from '@/lib/motion-variants';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import { useSellerHealth } from '@/hooks/queries/useSellerHealth';
import { format, addDays, startOfWeek } from 'date-fns';
import { notify } from '@/lib/notify';
import { usePaymentMode } from '@/hooks/usePaymentMode';
import {
  isUpiRequiredAndMissing,
  UPI_REQUIRED_FOR_GO_LIVE_MESSAGE,
  UPI_REQUIRED_TITLE,
} from '@/lib/sellerPaymentReadiness';
import { track } from '@/lib/analytics';
import { LoadFailureState } from '@/components/network/LoadFailureState';
import { useSlowLoading } from '@/hooks/useSlowLoading';

// Lazy: heavy secondary tabs - keep Orders path lean
const QuickActions = lazy(() =>
  import('@/components/seller/QuickActions').then((m) => ({ default: m.QuickActions })),
);
const CouponManager = lazy(() =>
  import('@/components/seller/CouponManager').then((m) => ({ default: m.CouponManager })),
);
const SellerAnalyticsTab = lazy(() =>
  import('@/components/seller/SellerAnalyticsTab').then((m) => ({ default: m.SellerAnalyticsTab })),
);
const DemandInsights = lazy(() =>
  import('@/components/seller/DemandInsights').then((m) => ({ default: m.DemandInsights })),
);
const StoreInsightsPanel = lazy(() =>
  import('@/components/seller/StoreInsightsPanel').then((m) => ({ default: m.StoreInsightsPanel })),
);
const SellerRefundList = lazy(() =>
  import('@/components/seller/SellerRefundList').then((m) => ({ default: m.SellerRefundList })),
);
const SellerCustomerDirectory = lazy(() =>
  import('@/components/seller/SellerCustomerDirectory').then((m) => ({ default: m.SellerCustomerDirectory })),
);
const SellerSupportTab = lazy(() =>
  import('@/components/seller/SellerSupportTab').then((m) => ({ default: m.SellerSupportTab })),
);
const BookingsHub = lazy(() =>
  import('@/components/seller/BookingsHub').then((m) => ({ default: m.BookingsHub })),
);
const SellerReliabilityScore = lazy(() =>
  import('@/components/seller/SellerReliabilityScore').then((m) => ({ default: m.SellerReliabilityScore })),
);
const LowStockAlerts = lazy(() =>
  import('@/components/seller/LowStockAlerts').then((m) => ({ default: m.LowStockAlerts })),
);

function TabFallback() {
  return (
    <div className="space-y-3 py-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export default function SellerDashboardPage() {
  const { user, sellerProfiles = [], currentSellerId } = useAuth();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const settings = useSystemSettings();
  const paymentMode = usePaymentMode();
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [healthSheetOpen, setHealthSheetOpen] = useState(false);
  const [dashboardTab, setDashboardTab] = useState('orders');

  useEffect(() => {
    const tab = searchParams.get('tab');
    const filter = searchParams.get('filter') as OrderFilter | null;
    const validTabs = new Set(['orders', 'support', 'refunds', 'schedule', 'tools', 'stats']);
    if (tab && validTabs.has(tab)) setDashboardTab(tab);
    if (filter && FILTER_LABELS[filter as keyof typeof FILTER_LABELS]) {
      setOrderFilter(filter);
    }
  }, [searchParams]);

  // Warm become-seller chunk so "Add Business" does not wait on lazy import
  useEffect(() => {
    prefetchSellerRoutes();
  }, []);

  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioSellerIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = isPortfolio
    ? currentSellerId
    : resolveOperationalSellerId(currentSellerId, sellerProfiles);

  useEffect(() => {
    track('seller_dashboard_opened', {
      seller_id: isPortfolio ? null : currentSellerId,
      portfolio: isPortfolio,
    });
  }, [currentSellerId, isPortfolio]);

  // Health checks for StoreStatusCard badge (single-store only)
  const { data: healthData } = useSellerHealth(isPortfolio ? null : activeSellerId);
  const healthTotal = healthData?.totalChecks || 0;
  const healthPassed = healthData?.passCount || 0;

  // Service bookings for schedule tab
  const { data: serviceBookings = [] } = useSellerServiceBookings(isPortfolio ? null : activeSellerId);

  // Support tickets use the seller's profile user id, not the store id.
  // The full store row is loaded further down, so read user_id from the auth list here.
  const activeSellerUserId =
    sellerProfiles.find((seller) => seller.id === activeSellerId)?.user_id || user?.id || '';
  const { data: supportTickets = [] } = useSellerTickets(activeSellerUserId);
  useSellerSupportRealtime(activeSellerUserId);
  const { data: hasBookableServices = false } = useSellerHasBookableServices(isPortfolio ? null : activeSellerId);

  // Synced by GlobalChatAlerts / useChatAlerts - no second realtime subscription
  const { data: chatUnreadCount = 0 } = useQuery({
    queryKey: ['chat-unread-count', user?.id],
    queryFn: async () => 0,
    initialData: 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    console.log('[SellerDashboard] Auth state:', { userId: user?.id, sellerProfilesCount: sellerProfiles?.length, activeSellerId, currentSellerId, isPortfolio });
  }, [user, sellerProfiles, activeSellerId, currentSellerId, isPortfolio]);

  // Keep cached orders on screen when the dashboard opens; only a genuine store
  // switch drops the previous store's board so it can never flash under the new one.
  const previousScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const scope = user ? `${user.id}:${activeSellerId ?? ''}` : null;
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = scope;
    const keys = [
      'seller-dashboard-stats',
      'seller-orders',
      'seller-order-filter-counts',
      'seller-analytics-charts',
      'seller-refund-requests',
      'seller-financial-summary',
      'seller-financial-activity',
    ];
    if (previousScope !== null && previousScope !== scope) {
      keys.forEach((key) => queryClient.removeQueries({ queryKey: [key] }));
    } else if (previousScope === null && scope) {
      keys.forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: [key] }, { cancelRefetch: false });
      });
    }
  }, [user, activeSellerId, isPortfolio, queryClient]);

  const profileQueryEnabled = !!user && !!activeSellerId && !isPortfolio;
  const profileQuery = useQuery({
    queryKey: ['seller-dashboard-profile', activeSellerId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('seller_profiles')
        .select('id, user_id, business_name, description, verification_status, is_available, rating, total_reviews, avg_response_minutes, completed_order_count, cancellation_rate, last_active_at, society_id, primary_group, latitude, longitude, rejection_note, operating_days, sell_beyond_community, delivery_radius_km, cover_image_url, profile_image_url, categories, is_featured, availability_start, availability_end, accepts_cod, accepts_upi, upi_id, upi_verification_status, pickup_payment_config, delivery_payment_config, created_at, updated_at, fulfillment_mode, minimum_order_amount, daily_order_limit')
        .eq('id', activeSellerId!)
        .abortSignal(signal)
        .single();
      if (error) {
        console.error('[SellerDashboard] Profile fetch error:', error);
        throw error;
      }
      return data as SellerProfile;
    },
    enabled: profileQueryEnabled,
    staleTime: 30_000,
  });
  const sellerProfile: SellerProfile | null = profileQueryEnabled ? profileQuery.data ?? null : null;
  const isLoadingProfile = profileQueryEnabled && profileQuery.isLoading;
  const isProfileOffline = profileQueryEnabled && !sellerProfile && profileQuery.fetchStatus === 'paused';
  const renderError = profileQueryEnabled && !sellerProfile && profileQuery.isError
    ? friendlyError(profileQuery.error) || 'Failed to load profile'
    : null;
  const profileSlow = useSlowLoading(isLoadingProfile);

  // Presence ping is a write: fire once per store per visit, never from the query (no retries / refetch loops).
  const lastActivePingRef = useRef<string | null>(null);
  useEffect(() => {
    const sellerId = sellerProfile?.id;
    if (!sellerId || !user?.id || lastActivePingRef.current === sellerId) return;
    lastActivePingRef.current = sellerId;
    supabase
      .from('seller_profiles')
      .update({ last_active_at: new Date().toISOString() } as any)
      .eq('id', sellerId)
      .eq('user_id', user.id)
      .then(() => undefined, () => undefined);
  }, [sellerProfile?.id, user?.id]);

  const { data: stats, isFetching: statsFetching, isError: statsError } = useSellerOrderStats(
    activeSellerId,
    isPortfolio ? portfolioSellerIds : null,
  );
  const {
    data: finance,
    isError: financeError,
  } = useSellerFinancialSummary(activeSellerId, isPortfolio ? portfolioSellerIds : null);
  const creditScopeIds = resolveSellerFinancialIds(activeSellerId, isPortfolio ? portfolioSellerIds : null);
  const { data: creditSummary } = useSellerCreditSummary(activeSellerId, isPortfolio ? portfolioSellerIds : null);
  const { data: creditActivated } = useSellerCreditActivation(isPortfolio ? null : activeSellerId);
  useSellerFinancialRealtime(creditScopeIds);
  useSellerCreditRealtime(creditScopeIds);
  const { data: filterCounts } = useSellerOrderFilterCounts(
    activeSellerId,
    isPortfolio ? portfolioSellerIds : null,
  );
  const {
    data: ordersPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: ordersLoading,
    isError: ordersFailed,
    isFetching: ordersFetching,
    fetchStatus: ordersFetchStatus,
    refetch: refetchOrders,
  } = useSellerOrdersInfinite(
    activeSellerId,
    orderFilter,
    isPortfolio ? portfolioSellerIds : null,
  );

  const allOrders = ordersPages?.pages.flat() || [];
  const ordersPaused = ordersFetchStatus === 'paused';
  const ordersSlow = useSlowLoading(allOrders.length === 0 && ordersLoading);
  const slaToastShownRef = useRef<string>('');

  useEffect(() => {
    const urgentOrders = allOrders.filter((order: any) => {
      if (!order?.auto_cancel_at) return false;
      if (!['placed', 'pending'].includes(order.status)) return false;
      const msLeft = new Date(order.auto_cancel_at).getTime() - Date.now();
      return msLeft > 0 && msLeft <= 2 * 60 * 1000;
    });

    if (urgentOrders.length === 0) {
      slaToastShownRef.current = '';
      return;
    }

    const toastKey = urgentOrders.map((order: any) => order.id).sort().join(',');
    if (slaToastShownRef.current === toastKey) return;
    slaToastShownRef.current = toastKey;

    const soonestMs = Math.min(...urgentOrders.map((order: any) => new Date(order.auto_cancel_at).getTime() - Date.now()));
    const soonestSeconds = Math.max(1, Math.ceil(soonestMs / 1000));
    const minutes = Math.floor(soonestSeconds / 60);
    const seconds = soonestSeconds % 60;

    toast.error(urgentOrders.length === 1 ? `Order #${urgentOrders[0].id.slice(0, 8)} needs a response now` : `${urgentOrders.length} orders need a response now`, {
      id: 'seller-sla-warning',
      description: `Respond within ${minutes}:${seconds.toString().padStart(2, '0')} to avoid auto-cancel.`,
    });
  }, [allOrders]);

  const toggleBusyRef = useRef(false);
  const toggleAvailability = async () => {
    if (!sellerProfile || toggleBusyRef.current) return;
    if (sellerProfile.verification_status !== 'approved') {
      notify.block('Your store must be approved before you can go live');
      return;
    }

    toggleBusyRef.current = true;
    try {
      const newVal = !sellerProfile.is_available;
      if (newVal && isUpiRequiredAndMissing(paymentMode.mode, sellerProfile as any)) {
        notify.block(UPI_REQUIRED_FOR_GO_LIVE_MESSAGE, { title: UPI_REQUIRED_TITLE });
        return;
      }
      const { error } = await supabase
        .from('seller_profiles')
        .update({ is_available: newVal })
        .eq('id', sellerProfile.id);

      if (error) throw error;

      queryClient.setQueryData(['seller-dashboard-profile', sellerProfile.id], (old: SellerProfile | undefined) =>
        old ? { ...old, is_available: newVal } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['seller-dashboard-profile', sellerProfile.id] });

      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: sellerProfile.is_available ? 'Store is now closed' : 'Store is now open',
        variant: 'success'
      });

      if (sellerProfile.society_id) {
        logAudit(
          newVal ? 'store_opened' : 'store_closed',
          'seller_profile',
          sellerProfile.id,
          sellerProfile.society_id
        );
      }
    } catch (error) {
      console.error('Error toggling availability:', error);
      toast.error(friendlyError(error));
    } finally {
      toggleBusyRef.current = false;
    }
  };

  // Orders stay reachable even when the dashboard profile cannot load.
  const sellingOrdersLink = (
    <Link to="/orders?tab=selling">
      <Button size="sm" variant="outline" className="w-full">Open my orders</Button>
    </Link>
  );

  if (isLoadingProfile) {
    const loadingStoreName = sellerProfiles.find((seller) => seller.id === activeSellerId)?.business_name;
    return (
      <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
        {profileSlow && (
          <div className="px-4 pt-4">
            <LoadFailureState variant="slow" compact onRetry={() => { void profileQuery.refetch(); }}>
              {sellingOrdersLink}
            </LoadFailureState>
          </div>
        )}
        <SellerDashboardLoadingState storeName={loadingStoreName} />
      </AppLayout>
    );
  }

  if (isProfileOffline || renderError) {
    return (
      <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
        <div className="p-4 py-12">
          <LoadFailureState
            variant={isProfileOffline ? 'offline' : 'error'}
            title={isProfileOffline ? "You're offline" : "Couldn't load your store"}
            description={isProfileOffline
              ? 'Your dashboard will load as soon as your connection is back.'
              : renderError || undefined}
            onRetry={() => { void profileQuery.refetch(); }}
            retrying={profileQuery.isFetching}
          >
            {sellingOrdersLink}
          </LoadFailureState>
        </div>
      </AppLayout>
    );
  }

  if (!isPortfolio && !sellerProfile) {
    return (
      <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
        <div className="p-4 text-center py-12">
          <p className="text-muted-foreground mb-2">
            You haven't set up your seller profile yet
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            {settings.sellerEmptyStateCopy}
          </p>
          <Link to="/become-seller">
            <Button>Become a Seller</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const pendingOrders = stats?.pendingOrders || 0;
  const pendingRefunds = stats?.pendingRefunds || 0;

  const pickStoreBanner = (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-3 flex items-start gap-2.5">
      <LayoutGrid size={16} className="text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Select a store for this tab</p>
        <p className="text-[11px] text-muted-foreground mb-2">
          Portfolio mode sums orders and sales. Store tools, refunds, and stats need one store.
        </p>
        <SellerSwitcher />
      </div>
    </div>
  );

  const activeSupportCount = supportTickets.filter((t: any) => ['open', 'seller_pending'].includes(t.status)).length;

  const emptyCopy = (() => {
    switch (orderFilter) {
      case 'pending':
        return {
          title: 'All caught up',
          body: 'No orders need your action right now. New placements will show here first.',
        };
      case 'upcoming':
        return {
          title: 'No upcoming scheduled orders',
          body: 'Future pre-orders and scheduled deliveries will appear here until their preparation window.',
        };
      case 'preparing':
        return { title: 'Nothing cooking', body: 'Accepted orders you are preparing appear here.' };
      case 'ready':
        return { title: 'No ready orders', body: 'Mark orders ready when they are packed for pickup or rider.' };
      case 'in_transit':
        return { title: 'Nothing in transit', body: 'Out-for-delivery orders will land in this board.' };
      case 'cod_confirm':
        return { title: 'No COD to confirm', body: 'Cash-on-delivery handoffs awaiting confirmation show here.' };
      case 'cancelled':
        return { title: 'No cancellations', body: 'Rejected and cancelled orders stay visible here for review.' };
      case 'refunded':
        return { title: 'No refunds', body: 'Refunded payments and settled disputes appear in this filter.' };
      case 'no_show':
        return { title: 'No no-shows', body: 'Booking no-shows appear here for follow-up.' };
      case 'terminal_fail':
        return { title: 'No failed orders', body: 'Returned or failed deliveries stay visible here.' };
      case 'enquiries':
        return { title: 'No enquiries', body: 'Quote requests and enquiries land in this board.' };
      default:
        return {
          title: orderFilter === 'all' ? 'No orders yet' : `No ${FILTER_LABELS[orderFilter] || orderFilter} orders`,
          body:
            orderFilter === 'all'
              ? 'Share your store link with neighbors to get your first order'
              : 'Orders in this status will appear here as buyers place them',
        };
    }
  })();

  return (
    <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
      <div className="p-4 stack-gap-lg">
        {isPortfolio ? (
          <PortfolioRollupStrip
            storeCount={portfolioSellerIds.length}
            actionNeeded={pendingOrders + pendingRefunds}
            settledTotal={stats?.totalEarnings || 0}
            settledToday={stats?.todayEarnings || 0}
          />
        ) : (
          <>
            <SellerJourneyBanner
              profiles={[sellerProfile]}
              creditActivated={isPortfolio ? undefined : creditActivated}
            />

            <StoreStatusCard
              sellerProfile={sellerProfile}
              sellerProfiles={sellerProfiles}
              onToggleAvailability={toggleAvailability}
              healthPassed={healthPassed}
              healthTotal={healthTotal}
              onHealthClick={() => setHealthSheetOpen(true)}
            />

            {(sellerProfile.verification_status === 'pending' || sellerProfile.verification_status === 'draft') && (
              <StoreCompletionCard
                sellerId={sellerProfile.id}
                businessName={sellerProfile.business_name}
                latitude={(sellerProfile as any).latitude}
                longitude={(sellerProfile as any).longitude}
                societyId={sellerProfile.society_id}
                profileImageUrl={(sellerProfile as any).profile_image_url}
                coverImageUrl={(sellerProfile as any).cover_image_url}
                acceptsUpi={(sellerProfile as any).accepts_upi}
                upiId={(sellerProfile as any).upi_id}
                fulfillmentMode={(sellerProfile as any).fulfillment_mode}
                verificationStatus={sellerProfile.verification_status}
                defaultActionType={(sellerProfile as any).default_action_type}
              />
            )}

            {sellerProfile.verification_status === 'approved' && pendingOrders === 0 && pendingRefunds === 0 && (
              <SellerFestivalParticipation sellerId={sellerProfile.id} variant="dashboard" />
            )}

            {sellerProfile.verification_status === 'approved' && (
              <div className="stack-gap-lg">
                <SellerTransferBanner
                  sellerId={activeSellerId}
                  portfolioIds={null}
                  available={finance?.available || 0}
                />
                <EarningsSummary
                  todayEarnings={stats?.todayEarnings || 0}
                  weekEarnings={stats?.weekEarnings || 0}
                  totalEarnings={stats?.totalEarnings || 0}
                  available={finance?.available || 0}
                  pending={(finance?.pending || 0) + (finance?.reserved || 0)}
                  paidOut={finance?.paidOut || 0}
                  compact
                  kpiError={statsError}
                  financeError={financeError}
                />
                <SocivaCreditsCard summary={creditSummary} compact />
              </div>
            )}

            <MissingLocationBanner
              sellerId={sellerProfile.id}
              hasCoordinates={!!(sellerProfile as any).latitude && !!(sellerProfile as any).longitude}
              hasSocietyId={!!sellerProfile.society_id}
            />

            <Sheet open={healthSheetOpen} onOpenChange={setHealthSheetOpen}>
              <SheetContent side="bottom" className="max-h-[70dvh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Store Health Checklist</SheetTitle>
                </SheetHeader>
                <div className="mt-4">
                  <SellerVisibilityChecklist sellerId={sellerProfile.id} />
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}

        {isPortfolio && (
          <div className="stack-gap-lg">
            <SellerTransferBanner
              sellerId={activeSellerId}
              portfolioIds={portfolioSellerIds}
              available={finance?.available || 0}
            />
            <SellerActivationBanner visible={(creditSummary?.available || 0) <= 0} allStores />
            <EarningsSummary
              todayEarnings={stats?.todayEarnings || 0}
              weekEarnings={stats?.weekEarnings || 0}
              totalEarnings={stats?.totalEarnings || 0}
              available={finance?.available || 0}
              pending={(finance?.pending || 0) + (finance?.reserved || 0)}
              paidOut={finance?.paidOut || 0}
              compact
              allStores
              kpiError={statsError}
              financeError={financeError}
            />
            <SocivaCreditsCard summary={creditSummary} compact allStores />
          </div>
        )}

        {/* Tab navigation */}
        <Tabs value={dashboardTab} onValueChange={setDashboardTab} className="w-full">
          <TabsList className={cn('sticky top-0 z-10 w-full h-11 bg-muted/80 backdrop-blur-sm grid grid-cols-6')}>
            <TabsTrigger value="orders" className="gap-1 text-[10px] sm:text-xs px-0.5 relative flex-col sm:flex-row">
              <ShoppingBag size={14} />
              <span>Orders</span>
              {pendingOrders > 0 && (
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] rounded-full">
                  {pendingOrders}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="support" className="gap-1 text-[10px] sm:text-xs px-0.5 relative flex-col sm:flex-row">
              <HeadphonesIcon size={14} />
              <span>Help</span>
              {activeSupportCount > 0 && (
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] rounded-full">
                  {activeSupportCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="refunds" className="gap-1 text-[10px] sm:text-xs px-0.5 relative flex-col sm:flex-row">
              <Receipt size={14} />
              <span>Refunds</span>
              {pendingRefunds > 0 && (
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] rounded-full animate-pulse">
                  {pendingRefunds}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1 text-[10px] sm:text-xs px-0.5 flex-col sm:flex-row">
              <CalendarDays size={14} />
              <span>Plan</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1 text-[10px] sm:text-xs px-0.5 flex-col sm:flex-row">
              <Wrench size={14} />
              <span>Store</span>
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1 text-[10px] sm:text-xs px-0.5 flex-col sm:flex-row">
              <BarChart3 size={14} />
              <span>Stats</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Orders Tab ── */}
          <TabsContent value="orders" className="space-y-4 mt-3">
            {!isPortfolio && sellerProfile && pendingRefunds > 0 && (
              <button
                type="button"
                onClick={() => setDashboardTab('refunds')}
                className="w-full rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-left"
              >
                <p className="text-sm font-semibold text-warning">
                  {pendingRefunds} refund{pendingRefunds !== 1 ? 's' : ''} need your response
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Tap to open Disputes &amp; Refunds</p>
              </button>
            )}
            {!isPortfolio && sellerProfile && (
              <AvailabilityPromptBanner sellerId={sellerProfile.id} />
            )}
            {isPortfolio && (
              <p className="text-[11px] text-muted-foreground -mt-1">
                Showing orders from all stores - labeled portfolio totals above.
              </p>
            )}

            {!isPortfolio && sellerProfile && (
              <UpcomingScheduledPanel
                sellerId={sellerProfile.id}
                onOpenCalendar={hasBookableServices ? () => setDashboardTab('schedule') : undefined}
              />
            )}

            <DashboardStats
              pendingOrders={pendingOrders}
              pendingDisputes={pendingRefunds}
              preparingOrders={stats?.preparingOrders || 0}
              inTransitOrders={stats?.inTransitOrders || 0}
              doneToday={stats?.doneToday || 0}
              terminalFailOrders={stats?.terminalFailOrders || 0}
              onKpiClick={setOrderFilter}
              onActionNeededClick={() => {
                if (pendingOrders > 0) {
                  setOrderFilter('pending');
                  return;
                }
                if (pendingRefunds > 0) {
                  setDashboardTab('refunds');
                }
              }}
              refreshing={statsFetching}
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">
                  {isPortfolio ? 'Orders · All stores' : 'Orders'}
                </h3>
                {statsFetching && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Updating
                  </span>
                )}
              </div>
              <div className="mb-3">
                <OrderFilters
                  currentFilter={orderFilter}
                  onFilterChange={setOrderFilter}
                  counts={filterCounts || emptyBoardCounts()}
                />
              </div>
              {allOrders.length > 0 && (ordersFailed || ordersPaused) && (
                <div
                  className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2"
                  role="status"
                  data-testid="seller-orders-stale-banner"
                >
                  <p className="text-xs text-muted-foreground">
                    {ordersPaused ? "You're offline - showing your last loaded orders." : "Couldn't refresh orders - showing your last loaded orders."}
                  </p>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => { void refetchOrders(); }} disabled={ordersFetching}>
                    {ordersFetching ? 'Retrying...' : 'Retry'}
                  </Button>
                </div>
              )}
              {allOrders.length === 0 && ordersLoading ? (
                <div className="space-y-3" data-testid="seller-orders-loading">
                  {ordersSlow && (
                    <LoadFailureState variant="slow" compact onRetry={() => { void refetchOrders(); }} />
                  )}
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-24 w-full rounded-xl" />
                </div>
              ) : allOrders.length === 0 && (ordersFailed || ordersPaused) ? (
                <LoadFailureState
                  variant={ordersPaused ? 'offline' : 'error'}
                  title={ordersPaused ? "You're offline" : "Couldn't load orders"}
                  description={ordersPaused
                    ? 'Your orders will load as soon as your connection is back.'
                    : 'Your orders are safe. This is a connection problem - please try again.'}
                  onRetry={() => { void refetchOrders(); }}
                  retrying={ordersFetching}
                />
              ) : allOrders.length > 0 ? (
                <motion.div
                  className="space-y-3"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                >
                  <AnimatePresence mode="popLayout">
                    {allOrders.map((order: any) => (
                      <motion.div key={order.id} variants={listItem} layout className="py-0.5">
                        <SellerOrderCard order={order} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {hasNextPage && (
                    <div className="flex justify-center py-2">
                      <Button variant="secondary" size="default" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                        {isFetchingNextPage ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : 'Load More'}
                      </Button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  className="text-center py-10 bg-muted/60 rounded-xl border border-dashed border-border"
                  variants={emptyState}
                  initial="hidden"
                  animate="show"
                >
                  <Package className="mx-auto text-muted-foreground mb-2" size={32} />
                  <p className="text-sm font-medium text-foreground">{emptyCopy.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                    {emptyCopy.body}
                  </p>
                  {orderFilter !== 'all' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 text-xs"
                      onClick={() => setOrderFilter('all')}
                    >
                      View all orders
                    </Button>
                  )}
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* ── Support Tab ── */}
          <TabsContent value="support" className="space-y-4 mt-3">
            {isPortfolio || !sellerProfile ? (
              pickStoreBanner
            ) : (
              <Suspense fallback={<TabFallback />}>
                <SellerSupportTab sellerUserId={activeSellerUserId} sellerProfileId={sellerProfile.id} />
              </Suspense>
            )}
          </TabsContent>

          {/* ── Refunds Tab ── */}
          <TabsContent value="refunds" className="space-y-4 mt-3">
            {isPortfolio || !sellerProfile ? (
              pickStoreBanner
            ) : (
              <Suspense fallback={<TabFallback />}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-sm">Disputes & Refunds</h3>
                </div>
                <SellerRefundList sellerId={sellerProfile.id} forceExpanded />
              </Suspense>
            )}
          </TabsContent>

          {/* ── Schedule Tab - bookings + scheduled cart orders ── */}
          <TabsContent value="schedule" className="space-y-4 mt-3">
            {isPortfolio || !sellerProfile ? pickStoreBanner : (
              <Suspense fallback={<TabFallback />}>
                {hasBookableServices ? (
                  <BookingsHub sellerId={sellerProfile.id} />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm">Scheduled Orders Calendar</h3>
                      <p className="text-[11px] text-muted-foreground">Pre-orders and scheduled deliveries by date</p>
                    </div>
                    <SellerScheduleView sellerId={sellerProfile.id} />
                  </div>
                )}
              </Suspense>
            )}
          </TabsContent>

          {/* ── Tools Tab ── */}
          <TabsContent value="tools" className="space-y-4 mt-3">
            {isPortfolio ? (
              pickStoreBanner
            ) : (
              <Suspense fallback={<TabFallback />}>
                <QuickActions />
                <Link to="/seller/messages" className="relative flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl shadow-sm hover:bg-accent/5 mt-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <MessageCircle size={16} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Messages & leads</p>
                      <p className="text-[11px] text-muted-foreground">Contact leads and order chats</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {chatUnreadCount > 0 && (
                      <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px] rounded-full">
                        {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                      </Badge>
                    )}
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </div>
                </Link>
                <div id="coupon-section">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Coupon Management</p>
                  <CouponManager />
                </div>
              </Suspense>
            )}
          </TabsContent>

          {/* ── Stats Tab - Deduplicated ── */}
          <TabsContent value="stats" className="space-y-4 mt-3">
            {isPortfolio || !sellerProfile ? (
              pickStoreBanner
            ) : (
              <Suspense fallback={<TabFallback />}>
                <StoreInsightsPanel sellerId={sellerProfile.id} />
                <SellerReliabilityScore sellerId={sellerProfile.id} />
                <LowStockAlerts sellerId={sellerProfile.id} />
                <SellerAnalyticsTab sellerId={sellerProfile.id} />
                <SellerCustomerDirectory sellerId={sellerProfile.id} />
                <DemandInsights societyId={sellerProfile.society_id} sellerId={sellerProfile.id} />
              </Suspense>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

