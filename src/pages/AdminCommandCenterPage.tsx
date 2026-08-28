// @ts-nocheck
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SocietySwitcher } from '@/components/admin/SocietySwitcher';
import { CommandCenterKpiStrip, type KpiKey } from '@/components/admin/command-center/CommandCenterKpiStrip';
import { CommandCenterSellersList } from '@/components/admin/command-center/CommandCenterSellersList';
import { CommandCenterOrdersList } from '@/components/admin/command-center/CommandCenterOrdersList';
import { CommandCenterProductsList } from '@/components/admin/command-center/CommandCenterProductsList';
import { CommandCenterBookingsList } from '@/components/admin/command-center/CommandCenterBookingsList';
import { CommandCenterEnquiriesList } from '@/components/admin/command-center/CommandCenterEnquiriesList';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCommandCenterBookings,
  useCommandCenterEnquiries,
  useCommandCenterOrders,
  useCommandCenterProducts,
  useCommandCenterSellers,
  useCommandCenterSnapshot,
} from '@/hooks/useCommandCenter';

type CommandCenterTab =
  | 'sellers'
  | 'orders'
  | 'products'
  | 'bookings'
  | 'enquiries'
  | 'attention';

function startOfTodayIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export default function AdminCommandCenterPage() {
  const { viewAsSocietyId, effectiveSocietyId, isAdmin } = useAuth();
  const societyScope = isAdmin ? viewAsSocietyId : effectiveSocietyId;
  const listRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<CommandCenterTab>('sellers');
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);

  const [sellerPage, setSellerPage] = useState(0);
  const [sellerVerification, setSellerVerification] = useState('all');
  const [sellerActiveOnly, setSellerActiveOnly] = useState('all');
  const [sellerSearch, setSellerSearch] = useState('');

  const [orderPage, setOrderPage] = useState(0);
  const [orderStatus, setOrderStatus] = useState('all');
  const [orderPaymentStatus, setOrderPaymentStatus] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSellerId, setOrderSellerId] = useState<string | null>(null);
  const [orderFrom, setOrderFrom] = useState<string | null>(null);

  const [productPage, setProductPage] = useState(0);
  const [productApproval, setProductApproval] = useState('all');
  const [productAvailableOnly, setProductAvailableOnly] = useState('all');
  const [productSearch, setProductSearch] = useState('');
  const [productSellerId, setProductSellerId] = useState<string | null>(null);

  const [bookingPage, setBookingPage] = useState(0);
  const [bookingStatus, setBookingStatus] = useState('all');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingSellerId, setBookingSellerId] = useState<string | null>(null);

  const [enquiryPage, setEnquiryPage] = useState(0);
  const [enquiryStatus, setEnquiryStatus] = useState('all');
  const [enquirySearch, setEnquirySearch] = useState('');
  const [enquirySellerId, setEnquirySellerId] = useState<string | null>(null);

  const snapshotQuery = useCommandCenterSnapshot(societyScope);

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

  const sellersQuery = useCommandCenterSellers(societyScope, sellerFilters);
  const ordersQuery = useCommandCenterOrders(societyScope, orderFilters);
  const productsQuery = useCommandCenterProducts(societyScope, productFilters);
  const bookingsQuery = useCommandCenterBookings(societyScope, bookingFilters);
  const enquiriesQuery = useCommandCenterEnquiries(societyScope, enquiryFilters);

  const applyKpi = (key: KpiKey) => {
    setActiveKpi(key);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (key === 'stores') {
      setActiveTab('sellers');
      setSellerVerification('all');
      setSellerActiveOnly('all');
      setSellerPage(0);
      return;
    }
    if (key === 'pending_stores') {
      setActiveTab('sellers');
      setSellerVerification('pending');
      setSellerActiveOnly('all');
      setSellerPage(0);
      return;
    }
    if (key === 'live_listings') {
      setActiveTab('products');
      setProductApproval('approved');
      setProductAvailableOnly('live');
      setProductSellerId(null);
      setProductPage(0);
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
      setOrderStatus('all');
      setOrderPaymentStatus('all');
      setOrderSellerId(null);
      setOrderFrom(startOfTodayIso());
      setOrderPage(0);
      return;
    }
    if (key === 'open_disputes') {
      setActiveTab('attention');
      return;
    }
    setActiveTab('attention');
  };

  const refreshAll = () => {
    snapshotQuery.refetch();
    sellersQuery.refetch();
    ordersQuery.refetch();
    productsQuery.refetch();
    bookingsQuery.refetch();
    enquiriesQuery.refetch();
  };

  const snapshot = snapshotQuery.data;

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
            <p className="text-xs text-muted-foreground">
              Society-wide operations snapshot · Phase 2
            </p>
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
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : snapshot ? (
          <>
            <CommandCenterKpiStrip snapshot={snapshot} activeKey={activeKpi} onSelect={applyKpi} />

            <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Orders (30d)</p>
                  <p className="text-lg font-bold tabular-nums">{snapshot.orders?.month ?? 0}</p>
                </div>
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setActiveTab('enquiries');
                    setEnquiryStatus('enquired');
                    setEnquiryPage(0);
                    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <p className="text-muted-foreground">Open enquiries</p>
                  <p className="text-lg font-bold tabular-nums">{snapshot.enquiries?.open ?? 0}</p>
                </button>
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setActiveTab('bookings');
                    setBookingStatus('all');
                    setBookingPage(0);
                    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <p className="text-muted-foreground">Service bookings</p>
                  <p className="text-lg font-bold tabular-nums">{snapshot.bookings?.total ?? 0}</p>
                </button>
                <div>
                  <p className="text-muted-foreground">Open refunds</p>
                  <p className="text-lg font-bold tabular-nums">{snapshot.refunds?.open ?? 0}</p>
                </div>
              </CardContent>
            </Card>

            {snapshot.as_of && (
              <p className="text-[11px] text-muted-foreground text-right">
                As of {format(new Date(snapshot.as_of), 'dd MMM yyyy, h:mm a')}
                {societyScope ? '' : ' · all societies'}
              </p>
            )}
          </>
        ) : null}

        <div ref={listRef}>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CommandCenterTab)}>
            <TabsList className="w-full grid grid-cols-3 lg:grid-cols-6 rounded-xl h-auto min-h-10 p-1">
              <TabsTrigger value="sellers" className="rounded-lg text-xs">
                Stores
              </TabsTrigger>
              <TabsTrigger value="orders" className="rounded-lg text-xs">
                Orders
              </TabsTrigger>
              <TabsTrigger value="products" className="rounded-lg text-xs">
                Products
              </TabsTrigger>
              <TabsTrigger value="bookings" className="rounded-lg text-xs">
                Bookings
              </TabsTrigger>
              <TabsTrigger value="enquiries" className="rounded-lg text-xs">
                Enquiries
              </TabsTrigger>
              <TabsTrigger value="attention" className="rounded-lg text-xs">
                Attention
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sellers" className="mt-4">
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
                }}
                onActiveOnlyChange={(v) => {
                  setSellerActiveOnly(v);
                  setSellerPage(0);
                }}
                onSearchChange={(v) => {
                  setSellerSearch(v);
                  setSellerPage(0);
                }}
                onSelectSeller={(sellerId) => {
                  setOrderSellerId(sellerId);
                  setOrderFrom(null);
                  setOrderStatus('all');
                  setOrderPaymentStatus('all');
                  setOrderPage(0);
                  setActiveTab('orders');
                }}
                isLoading={sellersQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="orders" className="mt-4">
              {orderSellerId && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <span>Filtered to one store</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setOrderSellerId(null);
                      setOrderPage(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              )}
              {orderFrom && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <span>Showing orders from today</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setOrderFrom(null);
                      setOrderPage(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>
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
                }}
                onPaymentStatusChange={(v) => {
                  setOrderPaymentStatus(v);
                  setOrderPage(0);
                }}
                onSearchChange={(v) => {
                  setOrderSearch(v);
                  setOrderPage(0);
                }}
                isLoading={ordersQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="products" className="mt-4">
              {productSellerId && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <span>Filtered to one store</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setProductSellerId(null);
                      setProductPage(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>
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
                }}
                onAvailableOnlyChange={(v) => {
                  setProductAvailableOnly(v);
                  setProductPage(0);
                }}
                onSearchChange={(v) => {
                  setProductSearch(v);
                  setProductPage(0);
                }}
                isLoading={productsQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="bookings" className="mt-4">
              {bookingSellerId && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <span>Filtered to one store</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setBookingSellerId(null);
                      setBookingPage(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              )}
              <CommandCenterBookingsList
                rows={bookingsQuery.data?.rows || []}
                total={bookingsQuery.data?.total || 0}
                page={bookingPage}
                onPageChange={setBookingPage}
                status={bookingStatus}
                search={bookingSearch}
                onStatusChange={(v) => {
                  setBookingStatus(v);
                  setBookingPage(0);
                }}
                onSearchChange={(v) => {
                  setBookingSearch(v);
                  setBookingPage(0);
                }}
                isLoading={bookingsQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="enquiries" className="mt-4">
              {enquirySellerId && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <span>Filtered to one store</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEnquirySellerId(null);
                      setEnquiryPage(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>
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
                }}
                onSearchChange={(v) => {
                  setEnquirySearch(v);
                  setEnquiryPage(0);
                }}
                isLoading={enquiriesQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="attention" className="mt-4 space-y-3">
              {snapshot && (
                <>
                  <AttentionRow
                    label="Pending store verifications"
                    count={snapshot.attention?.pending_store_verifications ?? 0}
                    actionLabel="View pending stores"
                    onClick={() => applyKpi('pending_stores')}
                  />
                  <AttentionRow
                    label="Pending product approvals"
                    count={snapshot.attention?.pending_product_approvals ?? 0}
                    actionLabel="View pending products"
                    onClick={() => applyKpi('pending_products')}
                  />
                  <AttentionRow
                    label="Open disputes"
                    count={snapshot.attention?.open_disputes ?? 0}
                    actionLabel="Open Disputes tab"
                    to="/admin"
                  />
                  <AttentionRow
                    label="Open refunds"
                    count={snapshot.attention?.open_refunds ?? 0}
                    actionLabel="Refund console"
                    to="/admin/refunds"
                  />
                  <AttentionRow
                    label="Payment-pending orders"
                    count={snapshot.attention?.payment_pending_orders ?? 0}
                    actionLabel="View orders"
                    onClick={() => {
                      setActiveTab('orders');
                      setOrderPaymentStatus('payment_pending');
                      setOrderPage(0);
                    }}
                  />
                  <AttentionRow
                    label="Open enquiries"
                    count={snapshot.enquiries?.open ?? 0}
                    actionLabel="View enquiries"
                    onClick={() => {
                      setActiveTab('enquiries');
                      setEnquiryStatus('enquired');
                      setEnquiryPage(0);
                    }}
                  />
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
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
