// @ts-nocheck
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SocietySwitcher } from '@/components/admin/SocietySwitcher';
import { CommandCenterKpiStrip, type KpiKey } from '@/components/admin/command-center/CommandCenterKpiStrip';
import { CommandCenterSellersList } from '@/components/admin/command-center/CommandCenterSellersList';
import { CommandCenterOrdersList } from '@/components/admin/command-center/CommandCenterOrdersList';
import { CommandCenterProductsList } from '@/components/admin/command-center/CommandCenterProductsList';
import { CommandCenterBookingsList } from '@/components/admin/command-center/CommandCenterBookingsList';
import { CommandCenterEnquiriesList } from '@/components/admin/command-center/CommandCenterEnquiriesList';
import { CommandCenterDisputesList } from '@/components/admin/command-center/CommandCenterDisputesList';
import { CommandCenterActivityFeed } from '@/components/admin/command-center/CommandCenterActivityFeed';
import { CommandCenterCategoryIntelligence } from '@/components/admin/command-center/CommandCenterCategoryIntelligence';
import { CommandCenterGlobalSearch } from '@/components/admin/command-center/CommandCenterGlobalSearch';
import { CommandCenterStore360Sheet } from '@/components/admin/command-center/CommandCenterStore360Sheet';
import { CommandCenterAttentionInbox } from '@/components/admin/command-center/CommandCenterAttentionInbox';
import { CommandCenterGrowthPanel } from '@/components/admin/command-center/CommandCenterGrowthPanel';
import { CommandCenterTrustPanel } from '@/components/admin/command-center/CommandCenterTrustPanel';
import { CommandCenterProductIntelligence } from '@/components/admin/command-center/CommandCenterProductIntelligence';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCommandCenterActivity,
  useCommandCenterAttentionQueue,
  useCommandCenterBookings,
  useCommandCenterCategoryIntelligence,
  useCommandCenterDisputes,
  useCommandCenterEnquiries,
  useCommandCenterGrowth,
  useCommandCenterOrders,
  useCommandCenterProducts,
  useCommandCenterReports,
  useCommandCenterSellers,
  useCommandCenterSnapshot,
  type CommandCenterAttentionRow,
} from '@/hooks/useCommandCenter';
import {
  COMMAND_CENTER_BUCKETS,
} from '@/lib/commandCenterBuckets';

type CommandCenterTab =
  | 'sellers'
  | 'orders'
  | 'products'
  | 'bookings'
  | 'enquiries'
  | 'disputes'
  | 'categories'
  | 'activity'
  | 'attention'
  | 'growth'
  | 'trust'
  | 'intelligence';

const VALID_TABS: CommandCenterTab[] = [
  'sellers',
  'orders',
  'products',
  'bookings',
  'enquiries',
  'disputes',
  'categories',
  'activity',
  'attention',
  'growth',
  'trust',
  'intelligence',
];

const VALID_KPIS: KpiKey[] = COMMAND_CENTER_BUCKETS.map((bucket) => bucket.id);

const MORE_OPTIONS: Array<{ value: string; label: string; tab: CommandCenterTab }> = [
  { value: 'stores', label: 'All stores', tab: 'sellers' },
  { value: 'products', label: 'All products', tab: 'products' },
  { value: 'bookings', label: 'Bookings', tab: 'bookings' },
  { value: 'activity', label: 'Activity', tab: 'activity' },
  { value: 'categories', label: 'Categories', tab: 'categories' },
  { value: 'growth', label: 'Growth', tab: 'growth' },
  { value: 'trust', label: 'Trust', tab: 'trust' },
  { value: 'intelligence', label: 'Intelligence', tab: 'intelligence' },
  { value: 'attention', label: 'Attention', tab: 'attention' },
];

function readParam(sp: URLSearchParams, key: string, fallback = 'all') {
  return sp.get(key) || fallback;
}

export default function AdminCommandCenterPage() {
  const { viewAsSocietyId, effectiveSocietyId, isAdmin, viewAsSociety, effectiveSociety } = useAuth();
  const societyScope = isAdmin ? viewAsSocietyId : effectiveSocietyId;
  const societyLabel = !societyScope
    ? 'All societies'
    : (isAdmin ? viewAsSociety?.name : effectiveSociety?.name) || 'This society';
  const listRef = useRef<HTMLDivElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlHydrated = useRef(false);

  const initialTab = (() => {
    const t = searchParams.get('tab') as CommandCenterTab | null;
    return t && VALID_TABS.includes(t) ? t : 'sellers';
  })();
  const initialKpi = (() => {
    const k = searchParams.get('kpi') as KpiKey | null;
    return k && VALID_KPIS.includes(k) ? k : null;
  })();
  const initialMore = (() => {
    if (initialKpi || !searchParams.has('tab')) return '';
    if (initialTab === 'sellers') return 'stores';
    if (initialTab === 'products') return 'products';
    if (initialTab === 'orders') return 'orders';
    return MORE_OPTIONS.some((option) => option.value === initialTab) ? initialTab : '';
  })();

  const [activeTab, setActiveTab] = useState<CommandCenterTab>(
    initialKpi === 'pending_stores' ? 'sellers'
      : initialKpi === 'pending_products' ? 'products'
      : initialKpi === 'orders_today' || initialKpi === 'payment_waiting' ? 'orders'
      : initialKpi === 'unanswered_enquiries' ? 'enquiries'
      : initialKpi === 'open_disputes' ? 'disputes'
      : initialTab,
  );
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(initialKpi);
  const [moreTab, setMoreTab] = useState(initialMore);
  const [store360SellerId, setStore360SellerId] = useState<string | null>(null);

  const [sellerPage, setSellerPage] = useState(0);
  const [sellerVerification, setSellerVerification] = useState(() =>
    initialKpi === 'pending_stores' ? 'pending' : readParam(searchParams, 'ov'),
  );
  const [sellerActiveOnly, setSellerActiveOnly] = useState('all');
  const [sellerSearch, setSellerSearch] = useState('');

  const [orderPage, setOrderPage] = useState(0);
  const [orderStatus, setOrderStatus] = useState(() =>
    initialKpi === 'orders_today' ? 'orders_today' : readParam(searchParams, 'os'),
  );
  const [orderPaymentStatus, setOrderPaymentStatus] = useState(() =>
    initialKpi === 'payment_waiting' ? 'pending_any' : readParam(searchParams, 'ops'),
  );
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSellerId, setOrderSellerId] = useState<string | null>(null);
  const [orderFrom, setOrderFrom] = useState<string | null>(() =>
    initialKpi === 'orders_today' || initialKpi === 'payment_waiting' ? null : searchParams.get('of'),
  );

  const [productPage, setProductPage] = useState(0);
  const [productApproval, setProductApproval] = useState(() =>
    initialKpi === 'pending_products' ? 'pending' : readParam(searchParams, 'pa'),
  );
  const [productAvailableOnly, setProductAvailableOnly] = useState(() =>
    initialKpi === 'pending_products' ? 'all' : readParam(searchParams, 'pav'),
  );
  const [productSearch, setProductSearch] = useState('');
  const [productSellerId, setProductSellerId] = useState<string | null>(null);

  const [bookingPage, setBookingPage] = useState(0);
  const [bookingStatus, setBookingStatus] = useState('all');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingSellerId, setBookingSellerId] = useState<string | null>(null);

  const [enquiryPage, setEnquiryPage] = useState(0);
  const [enquiryStatus, setEnquiryStatus] = useState(() =>
    initialKpi === 'unanswered_enquiries' ? 'unanswered' : readParam(searchParams, 'es'),
  );
  const [enquirySearch, setEnquirySearch] = useState('');
  const [enquirySellerId, setEnquirySellerId] = useState<string | null>(null);

  const [disputePage, setDisputePage] = useState(0);
  const [disputeStatus, setDisputeStatus] = useState(() =>
    initialKpi === 'open_disputes' ? 'open' : readParam(searchParams, 'ds'),
  );
  const [disputeSearch, setDisputeSearch] = useState('');
  const [disputeSellerId, setDisputeSellerId] = useState<string | null>(null);

  const [activityPage, setActivityPage] = useState(0);
  const [activityEventType, setActivityEventType] = useState('all');
  const [activitySellerId, setActivitySellerId] = useState<string | null>(null);

  const [attentionPage, setAttentionPage] = useState(0);
  const [reportPage, setReportPage] = useState(0);
  const [reportStatus, setReportStatus] = useState('all');

  const [categoryDrill, setCategoryDrill] = useState<string | null>(null);
  const [subcategoryDrill, setSubcategoryDrill] = useState<string | null>(null);

  useEffect(() => {
    urlHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!urlHydrated.current) return;
    const next = new URLSearchParams();
    if (activeKpi) next.set('kpi', activeKpi);
    else if (moreTab === 'stores') next.set('tab', 'sellers');
    else if (moreTab === 'products') next.set('tab', 'products');
    else if (moreTab === 'orders') next.set('tab', 'orders');
    else if (moreTab) next.set('tab', moreTab);
    if (sellerVerification !== 'all') next.set('ov', sellerVerification);
    if (orderStatus !== 'all') next.set('os', orderStatus);
    if (orderPaymentStatus !== 'all') next.set('ops', orderPaymentStatus);
    if (orderFrom) next.set('of', orderFrom);
    if (productApproval !== 'all') next.set('pa', productApproval);
    if (productAvailableOnly !== 'all') next.set('pav', productAvailableOnly);
    if (enquiryStatus !== 'all') next.set('es', enquiryStatus);
    if (disputeStatus !== 'all') next.set('ds', disputeStatus);
    setSearchParams(next, { replace: true });
  }, [
    activeKpi,
    moreTab,
    sellerVerification,
    orderStatus,
    orderPaymentStatus,
    orderFrom,
    productApproval,
    productAvailableOnly,
    enquiryStatus,
    disputeStatus,
    setSearchParams,
  ]);

  const snapshotQuery = useCommandCenterSnapshot(societyScope);
  const growthQuery = useCommandCenterGrowth(societyScope);
  const attentionQuery = useCommandCenterAttentionQueue(societyScope, attentionPage);
  const reportsQuery = useCommandCenterReports(
    societyScope,
    reportStatus === 'all' ? null : reportStatus,
    reportPage,
  );

  const sellerFilters = useMemo(
    () => ({
      verificationStatus: sellerVerification === 'all' ? null : sellerVerification,
      activeOnly:
        sellerActiveOnly === 'active' ? true : sellerActiveOnly === 'inactive' ? false : null,
      search: sellerSearch,
      page: sellerPage,
      pageSize: 25,
    }),
    [sellerVerification, sellerActiveOnly, sellerSearch, sellerPage],
  );

  const orderFilters = useMemo(
    () => ({
      status: orderStatus === 'all' ? null : orderStatus,
      paymentStatus: orderPaymentStatus === 'all' ? null : orderPaymentStatus,
      sellerId: orderSellerId,
      from: orderFrom,
      search: orderSearch,
      page: orderPage,
      pageSize: 25,
    }),
    [orderStatus, orderPaymentStatus, orderSellerId, orderFrom, orderSearch, orderPage],
  );

  const productFilters = useMemo(
    () => ({
      approvalStatus: productApproval === 'all' ? null : productApproval,
      sellerId: productSellerId,
      availableOnly:
        productAvailableOnly === 'live' ? true : productAvailableOnly === 'inactive' ? false : null,
      search: productSearch,
      page: productPage,
      pageSize: 25,
    }),
    [productApproval, productSellerId, productAvailableOnly, productSearch, productPage],
  );

  const bookingFilters = useMemo(
    () => ({
      status: bookingStatus === 'all' ? null : bookingStatus,
      sellerId: bookingSellerId,
      search: bookingSearch,
      page: bookingPage,
      pageSize: 25,
    }),
    [bookingStatus, bookingSellerId, bookingSearch, bookingPage],
  );

  const enquiryFilters = useMemo(
    () => ({
      status: enquiryStatus === 'all' ? null : enquiryStatus,
      sellerId: enquirySellerId,
      search: enquirySearch,
      page: enquiryPage,
      pageSize: 25,
    }),
    [enquiryStatus, enquirySellerId, enquirySearch, enquiryPage],
  );

  const disputeFilters = useMemo(
    () => ({
      status: disputeStatus === 'all' ? null : disputeStatus,
      sellerId: disputeSellerId,
      search: disputeSearch,
      page: disputePage,
      pageSize: 25,
    }),
    [disputeStatus, disputeSellerId, disputeSearch, disputePage],
  );

  const activityFilters = useMemo(
    () => ({
      eventType: activityEventType === 'all' ? null : activityEventType,
      sellerId: activitySellerId,
      page: activityPage,
      pageSize: 50,
    }),
    [activityEventType, activitySellerId, activityPage],
  );

  const sellersQuery = useCommandCenterSellers(societyScope, sellerFilters);
  const ordersQuery = useCommandCenterOrders(societyScope, orderFilters);
  const productsQuery = useCommandCenterProducts(societyScope, productFilters);
  const bookingsQuery = useCommandCenterBookings(societyScope, bookingFilters);
  const enquiriesQuery = useCommandCenterEnquiries(societyScope, enquiryFilters);
  const disputesQuery = useCommandCenterDisputes(societyScope, disputeFilters);
  const activityQuery = useCommandCenterActivity(societyScope, activityFilters);
  const categoryQuery = useCommandCenterCategoryIntelligence(
    societyScope,
    categoryDrill,
    subcategoryDrill,
  );

  const drillToSeller = (sellerId: string, tab: CommandCenterTab = 'orders') => {
    setOrderSellerId(sellerId);
    setProductSellerId(sellerId);
    setBookingSellerId(sellerId);
    setEnquirySellerId(sellerId);
    setDisputeSellerId(sellerId);
    setActivitySellerId(sellerId);
    setOrderFrom(null);
    setActiveKpi(null);
    setActiveTab(tab);
    setMoreTab(tab === 'sellers' ? 'stores' : tab === 'products' ? 'products' : tab);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const clearBucketSearches = () => {
    setSellerSearch('');
    setOrderSearch('');
    setProductSearch('');
    setEnquirySearch('');
    setDisputeSearch('');
  };

  const applyKpi = (key: KpiKey) => {
    setActiveKpi(key);
    setMoreTab('');
    clearBucketSearches();
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (key === 'pending_stores') {
      setActiveTab('sellers');
      setSellerVerification('pending');
      setSellerActiveOnly('all');
      setSellerPage(0);
      return;
    }
    if (key === 'pending_products') {
      setActiveTab('products');
      setProductApproval('pending');
      setProductAvailableOnly('all');
      setProductSellerId(null);
      setProductPage(0);
      return;
    }
    if (key === 'orders_today') {
      setActiveTab('orders');
      setOrderStatus('orders_today');
      setOrderPaymentStatus('all');
      setOrderSellerId(null);
      setOrderFrom(null);
      setOrderPage(0);
      return;
    }
    if (key === 'unanswered_enquiries') {
      setActiveTab('enquiries');
      setEnquiryStatus('unanswered');
      setEnquirySellerId(null);
      setEnquiryPage(0);
      return;
    }
    if (key === 'open_disputes') {
      setActiveTab('disputes');
      setDisputeStatus('open');
      setDisputeSellerId(null);
      setDisputePage(0);
      return;
    }
    setActiveTab('orders');
    setOrderPaymentStatus('pending_any');
    setOrderStatus('all');
    setOrderSellerId(null);
    setOrderFrom(null);
    setOrderPage(0);
  };

  const openMore = (value: string) => {
    const option = MORE_OPTIONS.find((item) => item.value === value);
    if (!option) return;
    setActiveKpi(null);
    setMoreTab(option.value);
    setActiveTab(option.tab);
    if (option.value === 'stores') {
      setSellerVerification('all');
      setSellerActiveOnly('all');
      setSellerSearch('');
      setSellerPage(0);
    }
    if (option.value === 'products') {
      setProductApproval('all');
      setProductAvailableOnly('all');
      setProductSellerId(null);
      setProductSearch('');
      setProductPage(0);
    }
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drillAttentionKind = (kind: string, row: CommandCenterAttentionRow) => {
    const normalized = kind
      .replace('pending_store_verifications', 'pending_store')
      .replace('pending_product_approvals', 'pending_product')
      .replace('unanswered_enquiries', 'unanswered')
      .replace('payment_pending_orders', 'payment_pending');

    if (normalized === 'pending_store') {
      applyKpi('pending_stores');
      if (row.seller_id) setStore360SellerId(row.seller_id);
      return;
    }
    if (normalized === 'pending_product') {
      applyKpi('pending_products');
      return;
    }
    if (normalized === 'open_disputes') {
      applyKpi('open_disputes');
      return;
    }
    if (normalized === 'unanswered') {
      applyKpi('unanswered_enquiries');
      return;
    }
    if (normalized === 'open_refunds') {
      navigate('/admin/refunds');
      return;
    }
    if (normalized === 'payment_pending') {
      applyKpi('payment_waiting');
    }
  };

  const refreshAll = () => {
    snapshotQuery.refetch();
    growthQuery.refetch();
    attentionQuery.refetch();
    reportsQuery.refetch();
    sellersQuery.refetch();
    ordersQuery.refetch();
    productsQuery.refetch();
    bookingsQuery.refetch();
    enquiriesQuery.refetch();
    disputesQuery.refetch();
    activityQuery.refetch();
    categoryQuery.refetch();
  };

  const snapshot = snapshotQuery.data;
  const growth = growthQuery.data;
  const showWorklist = Boolean(activeKpi || moreTab);

  const orderFromLabel = orderFrom
    ? `Showing orders from ${format(new Date(orderFrom), 'dd MMM yyyy')}`
    : null;

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">Command Center</h1>
            <p className="text-sm text-muted-foreground">{societyLabel}</p>
          </div>
          <SocietySwitcher />
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>

        {snapshotQuery.isError && (
          <p className="text-sm text-destructive">
            Command center snapshot could not be loaded. Deploy the latest migration if this is a new environment.
          </p>
        )}

        {snapshotQuery.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : snapshot ? (
          <CommandCenterKpiStrip snapshot={snapshot} activeKey={activeKpi} onSelect={applyKpi} />
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">More</p>
          <Select key={moreTab || 'home'} value={moreTab || undefined} onValueChange={openMore}>
            <SelectTrigger className="h-9 w-44 rounded-xl text-xs">
              <SelectValue placeholder="Reports" />
            </SelectTrigger>
            <SelectContent>
              {MORE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showWorklist && (
        <div ref={listRef} className="space-y-4">
          {!activeKpi && (
            <CommandCenterGlobalSearch
              societyId={societyScope}
              onSelectSeller={(sellerId) => {
                setStore360SellerId(sellerId);
                drillToSeller(sellerId, 'sellers');
              }}
              onSelectProduct={(_productId, sellerId) => drillToSeller(sellerId, 'products')}
              onSelectOrder={(_orderId, sellerId) => drillToSeller(sellerId, 'orders')}
              onSelectBooking={(_bookingId, sellerId) => drillToSeller(sellerId, 'bookings')}
              onSelectEnquiry={(_enquiryId, sellerId) => drillToSeller(sellerId, 'enquiries')}
              onSelectDispute={(_disputeId, _orderId, sellerId) => {
                if (sellerId) drillToSeller(sellerId, 'disputes');
                else applyKpi('open_disputes');
              }}
            />
          )}
          <Tabs value={activeTab}>

            <TabsContent value="sellers" className="mt-4">
              <BucketFrame
                active={activeKpi === 'pending_stores'}
                title="Pending stores"
                total={sellersQuery.data?.total || 0}
                loading={sellersQuery.isLoading}
                searching={Boolean(sellerSearch.trim())}
                emptyCopy="No stores waiting for approval."
              >
              {sellerVerification === 'pending' && activeKpi !== 'pending_stores' && (
                <FilterBanner
                  label="Showing pending store verifications"
                  onClear={() => { setSellerVerification('all'); setSellerPage(0); setActiveKpi(null); }}
                />
              )}
              <CommandCenterSellersList
                rows={sellersQuery.data?.rows || []}
                total={sellersQuery.data?.total || 0}
                page={sellerPage}
                onPageChange={setSellerPage}
                verificationStatus={sellerVerification}
                activeOnly={sellerActiveOnly}
                search={sellerSearch}
                onVerificationStatusChange={(v) => {
                  setSellerVerification(v);
                  setSellerPage(0);
                  if (v !== 'pending') setActiveKpi(null);
                }}
                onActiveOnlyChange={(v) => { setSellerActiveOnly(v); setSellerPage(0); setActiveKpi(null); }}
                onSearchChange={(v) => { setSellerSearch(v); setSellerPage(0); }}
                onSelectSeller={(sellerId) => drillToSeller(sellerId, 'orders')}
                onOpenStore360={setStore360SellerId}
                isLoading={sellersQuery.isLoading}
              />
              </BucketFrame>
            </TabsContent>

            <TabsContent value="orders" className="mt-4">
              <BucketFrame
                active={activeKpi === 'orders_today' || activeKpi === 'payment_waiting'}
                title={activeKpi === 'payment_waiting' ? 'Payment waiting' : 'Orders today'}
                total={ordersQuery.data?.total || 0}
                loading={ordersQuery.isLoading}
                searching={Boolean(orderSearch.trim() || orderSellerId)}
                emptyCopy={activeKpi === 'payment_waiting' ? 'No payments waiting.' : 'No orders since 12:00 AM IST.'}
              >
              {orderSellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setOrderSellerId(null); setOrderPage(0); }} />
              )}
              {orderFromLabel && (
                <FilterBanner label={orderFromLabel} onClear={() => { setOrderFrom(null); setOrderPage(0); setActiveKpi(null); }} />
              )}
              <CommandCenterOrdersList
                rows={ordersQuery.data?.rows || []}
                total={ordersQuery.data?.total || 0}
                page={orderPage}
                onPageChange={setOrderPage}
                status={orderStatus}
                paymentStatus={orderPaymentStatus}
                search={orderSearch}
                onStatusChange={(v) => {
                  setOrderStatus(v);
                  setOrderPage(0);
                  if (activeKpi === 'orders_today' || activeKpi === 'payment_waiting') setActiveKpi(null);
                }}
                onPaymentStatusChange={(v) => {
                  setOrderPaymentStatus(v);
                  setOrderPage(0);
                  if (activeKpi === 'orders_today' || activeKpi === 'payment_waiting') setActiveKpi(null);
                }}
                onSearchChange={(v) => { setOrderSearch(v); setOrderPage(0); }}
                isLoading={ordersQuery.isLoading}
              />
              </BucketFrame>
            </TabsContent>

            <TabsContent value="products" className="mt-4">
              <BucketFrame
                active={activeKpi === 'pending_products'}
                title="Pending products"
                total={productsQuery.data?.total || 0}
                loading={productsQuery.isLoading}
                searching={Boolean(productSearch.trim() || productSellerId)}
                emptyCopy="No products waiting for approval."
              >
              {productSellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setProductSellerId(null); setProductPage(0); }} />
              )}
              <CommandCenterProductsList
                rows={productsQuery.data?.rows || []}
                total={productsQuery.data?.total || 0}
                page={productPage}
                onPageChange={setProductPage}
                approvalStatus={productApproval}
                availableOnly={productAvailableOnly}
                search={productSearch}
                onApprovalStatusChange={(v) => {
                  setProductApproval(v);
                  setProductPage(0);
                  if (v !== 'pending') setActiveKpi(null);
                }}
                onAvailableOnlyChange={(v) => { setProductAvailableOnly(v); setProductPage(0); setActiveKpi(null); }}
                onSearchChange={(v) => { setProductSearch(v); setProductPage(0); }}
                isLoading={productsQuery.isLoading}
              />
              </BucketFrame>
            </TabsContent>

            <TabsContent value="bookings" className="mt-4">
              {bookingSellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setBookingSellerId(null); setBookingPage(0); }} />
              )}
              <CommandCenterBookingsList
                rows={bookingsQuery.data?.rows || []}
                total={bookingsQuery.data?.total || 0}
                page={bookingPage}
                onPageChange={setBookingPage}
                status={bookingStatus}
                search={bookingSearch}
                onStatusChange={(v) => { setBookingStatus(v); setBookingPage(0); }}
                onSearchChange={(v) => { setBookingSearch(v); setBookingPage(0); }}
                isLoading={bookingsQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="enquiries" className="mt-4">
              <BucketFrame
                active={activeKpi === 'unanswered_enquiries'}
                title="Unanswered enquiries"
                total={enquiriesQuery.data?.total || 0}
                loading={enquiriesQuery.isLoading}
                searching={Boolean(enquirySearch.trim() || enquirySellerId)}
                emptyCopy="No enquiries waiting for a seller reply."
              >
              {enquirySellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setEnquirySellerId(null); setEnquiryPage(0); }} />
              )}
              <CommandCenterEnquiriesList
                rows={enquiriesQuery.data?.rows || []}
                total={enquiriesQuery.data?.total || 0}
                page={enquiryPage}
                onPageChange={setEnquiryPage}
                status={enquiryStatus}
                search={enquirySearch}
                onStatusChange={(v) => {
                  setEnquiryStatus(v);
                  setEnquiryPage(0);
                  if (v !== 'unanswered') setActiveKpi(null);
                }}
                onSearchChange={(v) => { setEnquirySearch(v); setEnquiryPage(0); }}
                isLoading={enquiriesQuery.isLoading}
              />
              </BucketFrame>
            </TabsContent>

            <TabsContent value="disputes" className="mt-4">
              <BucketFrame
                active={activeKpi === 'open_disputes'}
                title="Open disputes"
                total={disputesQuery.data?.total || 0}
                loading={disputesQuery.isLoading}
                searching={Boolean(disputeSearch.trim() || disputeSellerId)}
                emptyCopy="No open disputes."
              >
              {disputeSellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setDisputeSellerId(null); setDisputePage(0); }} />
              )}
              <CommandCenterDisputesList
                rows={disputesQuery.data?.rows || []}
                total={disputesQuery.data?.total || 0}
                page={disputePage}
                onPageChange={setDisputePage}
                status={disputeStatus}
                search={disputeSearch}
                onStatusChange={(v) => {
                  setDisputeStatus(v);
                  setDisputePage(0);
                  if (v !== 'open') setActiveKpi(null);
                }}
                onSearchChange={(v) => { setDisputeSearch(v); setDisputePage(0); }}
                onSelectSeller={(sellerId) => drillToSeller(sellerId, 'orders')}
                isLoading={disputesQuery.isLoading}
              />
              </BucketFrame>
            </TabsContent>

            <TabsContent value="categories" className="mt-4">
              <CommandCenterCategoryIntelligence
                data={categoryQuery.data}
                isLoading={categoryQuery.isLoading}
                selectedCategory={categoryDrill}
                selectedSubcategoryId={subcategoryDrill}
                onSelectCategory={(category) => {
                  setCategoryDrill(category);
                  setSubcategoryDrill(null);
                }}
                onSelectSubcategory={(category, subcategoryId) => {
                  setCategoryDrill(category);
                  setSubcategoryDrill(subcategoryId);
                }}
                onSelectSeller={(sellerId) => drillToSeller(sellerId, 'sellers')}
                onSelectProduct={(_productId, sellerId) => drillToSeller(sellerId, 'products')}
                onBack={() => {
                  if (subcategoryDrill) setSubcategoryDrill(null);
                  else setCategoryDrill(null);
                }}
              />
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              {activitySellerId && (
                <FilterBanner label="Filtered to one store" onClear={() => { setActivitySellerId(null); setActivityPage(0); }} />
              )}
              <CommandCenterActivityFeed
                rows={activityQuery.data?.rows || []}
                total={activityQuery.data?.total || 0}
                page={activityPage}
                onPageChange={setActivityPage}
                eventType={activityEventType}
                onEventTypeChange={(v) => { setActivityEventType(v); setActivityPage(0); }}
                onSelectSeller={(sellerId) => drillToSeller(sellerId, 'sellers')}
                isLoading={activityQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="attention" className="mt-4 space-y-4">
              <CommandCenterAttentionInbox
                rows={attentionQuery.data?.rows || []}
                total={attentionQuery.data?.total || 0}
                page={attentionPage}
                onPageChange={setAttentionPage}
                onDrillKind={drillAttentionKind}
                isLoading={attentionQuery.isLoading}
              />
              {snapshot && (
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Attention summary
                  </p>
                  <AttentionRow label="Pending store verifications" count={snapshot.attention?.pending_store_verifications ?? 0} actionLabel="View pending stores" onClick={() => applyKpi('pending_stores')} />
                  <AttentionRow label="Pending product approvals" count={snapshot.attention?.pending_product_approvals ?? 0} actionLabel="View pending products" onClick={() => applyKpi('pending_products')} />
                  <AttentionRow label="Open disputes" count={snapshot.attention?.open_disputes ?? 0} actionLabel="View disputes" onClick={() => applyKpi('open_disputes')} />
                  <AttentionRow label="Unanswered enquiries" count={snapshot.buckets?.unanswered_enquiries ?? snapshot.attention?.unanswered_enquiries ?? 0} actionLabel="View enquiries" onClick={() => applyKpi('unanswered_enquiries')} />
                  <AttentionRow label="Open refunds" count={snapshot.attention?.open_refunds ?? 0} actionLabel="Refund console" to="/admin/refunds" />
                  <AttentionRow label="Payment-pending orders" count={snapshot.buckets?.payment_waiting ?? snapshot.attention?.payment_pending_orders ?? 0} actionLabel="View orders" onClick={() => applyKpi('payment_waiting')} />
                  <AttentionRow label="Open enquiries" count={snapshot.enquiries?.open ?? 0} actionLabel="View enquiries" onClick={() => { setActiveTab('enquiries'); setEnquiryStatus('open'); setEnquiryPage(0); }} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="growth" className="mt-4">
              <CommandCenterGrowthPanel data={growth} isLoading={growthQuery.isLoading} />
            </TabsContent>

            <TabsContent value="trust" className="mt-4">
              <CommandCenterTrustPanel
                rows={reportsQuery.data?.rows || []}
                total={reportsQuery.data?.total || 0}
                page={reportPage}
                onPageChange={setReportPage}
                status={reportStatus}
                onStatusChange={(v) => { setReportStatus(v); setReportPage(0); }}
                onOpenStore360={setStore360SellerId}
                isLoading={reportsQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="intelligence" className="mt-4">
              <CommandCenterProductIntelligence societyId={societyScope} />
            </TabsContent>
          </Tabs>
        </div>
        )}
      </div>

      <CommandCenterStore360Sheet
        sellerId={store360SellerId}
        open={Boolean(store360SellerId)}
        onOpenChange={(open) => { if (!open) setStore360SellerId(null); }}
        onViewOrders={(sellerId) => drillToSeller(sellerId, 'orders')}
        onViewProducts={(sellerId) => drillToSeller(sellerId, 'products')}
      />
    </AppLayout>
  );
}

function FilterBanner({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
      <span>{label}</span>
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>Clear</Button>
    </div>
  );
}

function BucketFrame({
  active,
  title,
  total,
  loading,
  searching,
  emptyCopy,
  children,
}: {
  active: boolean;
  title: string;
  total: number;
  loading: boolean;
  searching: boolean;
  emptyCopy: string;
  children: ReactNode;
}) {
  if (!active) return children;
  if (!loading && total === 0 && !searching) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">{title} · 0</h2>
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground">
            None right now. {emptyCopy}
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{title} · {loading ? '…' : total}</h2>
      {children}
    </div>
  );
}

function AttentionRow({
  label,
  count,
  actionLabel,
  to,
  onClick,
}: {
  label: string;
  count: number;
  actionLabel: string;
  to?: string;
  onClick?: () => void;
}) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-2xl font-extrabold tabular-nums mt-1">{count}</p>
        </div>
        {to ? (
          <Button asChild size="sm" variant="outline" className="rounded-xl text-xs shrink-0">
            <Link to={to}>{actionLabel}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="rounded-xl text-xs shrink-0" onClick={onClick}>
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
