// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { SellerProfile } from '@/types/database';
import { Package, Loader2, CalendarDays, Wrench, BarChart3, ShoppingBag, HeadphonesIcon, Receipt, MessageCircle, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { friendlyError, cn } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, XCircle } from 'lucide-react';

// Import refactored components
import { StoreStatusCard } from '@/components/seller/StoreStatusCard';
import { SellerVisibilityChecklist } from '@/components/seller/SellerVisibilityChecklist';
import { EarningsSummary } from '@/components/seller/EarningsSummary';
import { DashboardStats } from '@/components/seller/DashboardStats';
import { QuickActions } from '@/components/seller/QuickActions';
import { OrderFilters, OrderFilter } from '@/components/seller/OrderFilters';
import { SellerOrderCard } from '@/components/seller/SellerOrderCard';
import { CouponManager } from '@/components/seller/CouponManager';
import { SellerAnalyticsTab } from '@/components/seller/SellerAnalyticsTab';
import { DemandInsights } from '@/components/seller/DemandInsights';
import { SellerRefundList } from '@/components/seller/SellerRefundList';
import { SellerCustomerDirectory } from '@/components/seller/SellerCustomerDirectory';
import { SellerSupportTab } from '@/components/seller/SellerSupportTab';
import { useSellerTickets, useSellerSupportRealtime } from '@/hooks/useSupportTickets';

import { BookingsHub } from '@/components/seller/BookingsHub';
import { useSellerServiceBookings } from '@/hooks/useServiceBookings';
import { AvailabilityPromptBanner } from '@/components/seller/AvailabilityPromptBanner';
import { MissingLocationBanner } from '@/components/seller/MissingLocationBanner';
import { useSellerOrderStats, useSellerOrdersInfinite, useSellerOrderFilterCounts } from '@/hooks/queries/useSellerOrders';
import { useSellerHasBookableServices } from '@/hooks/useSellerHasBookableServices';

// Lazy import for reliability score and low stock (used in Stats tab)
import { SellerReliabilityScore } from '@/components/seller/SellerReliabilityScore';
import { LowStockAlerts } from '@/components/seller/LowStockAlerts';
import { useSellerHealth } from '@/hooks/queries/useSellerHealth';
import { format, addDays, startOfWeek } from 'date-fns';
import { notify } from '@/lib/notify';

export default function SellerDashboardPage() {
  const { user, sellerProfiles = [], currentSellerId } = useAuth();
  const queryClient = useQueryClient();
  const settings = useSystemSettings();
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [healthSheetOpen, setHealthSheetOpen] = useState(false);

  const activeSellerId = currentSellerId || (Array.isArray(sellerProfiles) && sellerProfiles.length > 0 ? sellerProfiles[0].id : null);

  // Health checks for StoreStatusCard badge
  const { data: healthData } = useSellerHealth(activeSellerId);
  const healthTotal = healthData?.totalChecks || 0;
  const healthPassed = healthData?.passCount || 0;

  // Service bookings for schedule tab
  const { data: serviceBookings = [] } = useSellerServiceBookings(activeSellerId);

  // Support tickets — keyed off seller's profiles.id (user_id), NOT seller_profiles.id.
  const activeSellerUserId = sellerProfile?.user_id || user?.id || '';
  const { data: supportTickets = [] } = useSellerTickets(activeSellerUserId);
  useSellerSupportRealtime(activeSellerUserId);
  const { data: hasBookableServices = false } = useSellerHasBookableServices(activeSellerId);

  useEffect(() => {
    console.log('[SellerDashboard] Auth state:', { userId: user?.id, sellerProfilesCount: sellerProfiles?.length, activeSellerId, currentSellerId });
  }, [user, sellerProfiles, activeSellerId, currentSellerId]);

  useEffect(() => {
    setSellerProfile(null);
    setIsLoadingProfile(true);
    queryClient.removeQueries({ queryKey: ['seller-dashboard-stats'] });
    queryClient.removeQueries({ queryKey: ['seller-orders'] });
    queryClient.removeQueries({ queryKey: ['seller-order-filter-counts'] });
    if (user && activeSellerId) {
      fetchSellerProfile(activeSellerId);
    } else {
      setIsLoadingProfile(false);
    }
  }, [user, activeSellerId]);

  const fetchSellerProfile = async (sellerId: string) => {
    setIsLoadingProfile(true);
    setRenderError(null);
    try {
      const { data: profile, error } = await supabase
        .from('seller_profiles')
        .select('id, user_id, business_name, description, verification_status, is_available, rating, total_reviews, avg_response_minutes, completed_order_count, cancellation_rate, last_active_at, society_id, primary_group, latitude, longitude, rejection_note, operating_days, sell_beyond_community, delivery_radius_km, cover_image_url, profile_image_url, categories, is_featured, availability_start, availability_end, accepts_cod, accepts_upi, upi_id, upi_verification_status, pickup_payment_config, delivery_payment_config, created_at, updated_at, fulfillment_mode, minimum_order_amount, daily_order_limit')
        .eq('id', sellerId)
        .single();

      if (error) {
        console.error('[SellerDashboard] Profile fetch error:', error);
        setRenderError(`Failed to load profile: ${error.message}`);
      }
      setSellerProfile(profile ? (profile as SellerProfile) : null);

      if (profile && user?.id) {
        supabase
          .from('seller_profiles')
          .update({ last_active_at: new Date().toISOString() } as any)
          .eq('id', sellerId)
          .eq('user_id', user.id)
          .then(() => undefined)
          .catch(() => undefined);
      }
    } catch (error) {
      console.error('[SellerDashboard] Unexpected error:', error);
      setRenderError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const { data: stats } = useSellerOrderStats(activeSellerId);
  const { data: filterCounts } = useSellerOrderFilterCounts(activeSellerId);
  const {
    data: ordersPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSellerOrdersInfinite(activeSellerId, orderFilter);

  const allOrders = ordersPages?.pages.flat() || [];
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
      if (newVal) {
        const wantsOnline =
          !!(sellerProfile as any).accepts_upi ||
          !!(sellerProfile as any).pickup_payment_config?.accepts_online ||
          !!(sellerProfile as any).delivery_payment_config?.accepts_online;
        const upiValid =
          (sellerProfile as any).upi_verification_status === 'valid' &&
          !!(sellerProfile as any).upi_id;
        if (wantsOnline && !upiValid) {
          notify.block('Verify your UPI ID before going live with online payments, or disable online payments in Settings');
          return;
        }
      }
      const { error } = await supabase
        .from('seller_profiles')
        .update({ is_available: newVal })
        .eq('id', sellerProfile.id);

      if (error) throw error;

      setSellerProfile({ ...sellerProfile, is_available: newVal });
      fetchSellerProfile(sellerProfile.id);

      toast.success(
        sellerProfile.is_available ? 'Store is now closed' : 'Store is now open'
      );

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

  if (isLoadingProfile) {
    return (
      <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
        <div className="p-4 space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (renderError) {
    return (
      <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
        <div className="p-4 text-center py-12">
          <p className="text-destructive mb-2">Something went wrong</p>
          <p className="text-xs text-muted-foreground mb-4">{renderError}</p>
          <Button onClick={() => activeSellerId && fetchSellerProfile(activeSellerId)}>Try Again</Button>
        </div>
      </AppLayout>
    );
  }

  if (!sellerProfile) {
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

  const activeSupportCount = supportTickets.filter((t: any) => ['open', 'seller_pending'].includes(t.status)).length;

  return (
    <AppLayout headerTitle="Seller Dashboard" showLocation={false}>
      <div className="p-4 space-y-4">
        {/* Rejection / Pending banner */}
        {sellerProfile.verification_status !== 'approved' && (
          <div className={cn(
            'rounded-xl border p-4 space-y-2',
            sellerProfile.verification_status === 'rejected'
              ? 'bg-destructive/10 border-destructive/20'
              : 'bg-warning/10 border-warning/20',
          )}>
            <div className="flex items-start gap-2">
              {sellerProfile.verification_status === 'rejected' ? (
                <XCircle size={18} className="text-destructive shrink-0 mt-0.5" />
              ) : (
                <Clock size={18} className="text-warning shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {sellerProfile.verification_status === 'rejected'
                    ? 'Your store application was rejected'
                    : 'Your store is pending review'}
                </p>
                {(sellerProfile as any).rejection_note && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Reason: {(sellerProfile as any).rejection_note}
                  </p>
                )}
                <Link to="/become-seller">
                  <Button size="sm" variant={sellerProfile.verification_status === 'rejected' ? 'destructive' : 'outline'} className="mt-2 h-8 text-xs">
                    {sellerProfile.verification_status === 'rejected' ? 'Update & Resubmit' : 'View Application'}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Store Status Card — with health badge + preview button merged in */}
        <StoreStatusCard
          sellerProfile={sellerProfile}
          sellerProfiles={sellerProfiles}
          onToggleAvailability={toggleAvailability}
          healthPassed={healthPassed}
          healthTotal={healthTotal}
          onHealthClick={() => setHealthSheetOpen(true)}
        />

        {/* Compact Earnings Bar — always visible */}
        {sellerProfile.verification_status === 'approved' && (
          <EarningsSummary
            todayEarnings={stats?.todayEarnings || 0}
            weekEarnings={stats?.weekEarnings || 0}
            totalEarnings={stats?.totalEarnings || 0}
            compact
          />
        )}

        <MissingLocationBanner
          sellerId={sellerProfile.id}
          hasCoordinates={!!(sellerProfile as any).latitude && !!(sellerProfile as any).longitude}
          hasSocietyId={!!sellerProfile.society_id}
        />

        {/* Health checklist in a drawer */}
        <Sheet open={healthSheetOpen} onOpenChange={setHealthSheetOpen}>
          <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Store Health Checklist</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <SellerVisibilityChecklist sellerId={sellerProfile.id} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Tab navigation */}
        <Tabs defaultValue="orders" className="w-full">
          <TabsList className={cn('sticky top-0 z-10 w-full h-11 bg-muted/80 backdrop-blur-sm grid', hasBookableServices ? 'grid-cols-6' : 'grid-cols-5')}>
            <TabsTrigger value="orders" className="gap-1.5 text-xs px-1 relative">
              <ShoppingBag size={14} />
              <span className="hidden min-[420px]:inline">Orders</span>
              {pendingOrders > 0 && (
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] rounded-full">
                  {pendingOrders}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="support" className="gap-1.5 text-xs px-1 relative">
              <HeadphonesIcon size={14} />
              <span className="hidden min-[420px]:inline">Support</span>
              {activeSupportCount > 0 && (
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] rounded-full">
                  {activeSupportCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="refunds" className="gap-1.5 text-xs px-1">
              <Receipt size={14} />
              <span className="hidden min-[420px]:inline">Refunds</span>
            </TabsTrigger>
            {hasBookableServices && (
              <TabsTrigger value="schedule" className="gap-1.5 text-xs px-1">
                <CalendarDays size={14} />
                <span className="hidden min-[420px]:inline">Schedule</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="tools" className="gap-1.5 text-xs px-1">
              <Wrench size={14} />
              <span className="hidden min-[420px]:inline">Tools</span>
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1.5 text-xs px-1">
              <BarChart3 size={14} />
              <span className="hidden min-[420px]:inline">Stats</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Orders Tab ── */}
          <TabsContent value="orders" className="space-y-4 mt-3">
            <AvailabilityPromptBanner sellerId={sellerProfile.id} />

            <DashboardStats
              totalOrders={stats?.totalOrders || 0}
              pendingOrders={pendingOrders}
              todayOrders={stats?.todayOrders || 0}
              completedOrders={stats?.completedOrders || 0}
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Orders</h3>
              </div>
              <div className="mb-3">
                <OrderFilters
                  currentFilter={orderFilter}
                  onFilterChange={setOrderFilter}
                  counts={filterCounts || { all: 0, today: 0, enquiries: 0, pending: 0, preparing: 0, ready: 0, completed: 0 }}
                />
              </div>
              {allOrders.length > 0 ? (
                <div className="space-y-3">
                  {allOrders.map((order: any) => (
                    <div key={order.id} className="py-0.5">
                      <SellerOrderCard order={order} />
                    </div>
                  ))}
                  {hasNextPage && (
                    <div className="flex justify-center py-2">
                      <Button variant="secondary" size="default" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                        {isFetchingNextPage ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : 'Load More'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 bg-muted rounded-xl">
                  <Package className="mx-auto text-muted-foreground mb-2" size={32} />
                  <p className="text-sm text-muted-foreground">
                    No {orderFilter !== 'all' ? orderFilter : ''} orders
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {orderFilter === 'all'
                      ? 'Share your store link with neighbors to get your first order'
                      : 'Orders in this status will appear here as buyers place them'}
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Support Tab ── */}
          <TabsContent value="support" className="space-y-4 mt-3">
            <SellerSupportTab sellerUserId={activeSellerUserId} sellerProfileId={sellerProfile.id} />
          </TabsContent>

          {/* ── Refunds Tab ── */}
          <TabsContent value="refunds" className="space-y-4 mt-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-sm">Disputes & Refunds</h3>
            </div>
            <SellerRefundList sellerId={sellerProfile.id} forceExpanded />
          </TabsContent>

          {/* ── Schedule Tab (unified Bookings hub) ── */}
          {hasBookableServices && (
            <TabsContent value="schedule" className="space-y-4 mt-3">
              <BookingsHub sellerId={sellerProfile.id} />
            </TabsContent>
          )}

          {/* ── Tools Tab ── */}
          <TabsContent value="tools" className="space-y-4 mt-3">
            <QuickActions />
            <Link to="/seller/messages" className="flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl shadow-sm hover:bg-accent/5 mt-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageCircle size={16} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Messages</p>
                  <p className="text-[11px] text-muted-foreground">Customer conversations</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
            <div id="coupon-section">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Coupon Management</p>
              <CouponManager />
            </div>
          </TabsContent>

          {/* ── Stats Tab — Deduplicated ── */}
          <TabsContent value="stats" className="space-y-4 mt-3">
            <SellerReliabilityScore sellerId={sellerProfile.id} />
            <LowStockAlerts sellerId={sellerProfile.id} />

            <SellerAnalyticsTab sellerId={sellerProfile.id} />
            <SellerCustomerDirectory sellerId={sellerProfile.id} />
            <DemandInsights societyId={sellerProfile.society_id} sellerId={sellerProfile.id} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

