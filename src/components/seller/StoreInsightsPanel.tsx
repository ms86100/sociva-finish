import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrency } from '@/hooks/useCurrency';
import {
  clusterSearchDemand,
  conversionPercent,
  stripBuyerIdentity,
  type SearchDemandInput,
} from '@/lib/marketplace-intelligence';

type ProductRow = {
  product_id: string;
  name: string;
  price: number | null;
  views: number;
  unique_viewers: number;
  cart_adds: number;
  orders: number;
  last_viewed_at: string | null;
};

type RecentOrder = {
  status: string;
  total_amount: number;
  created_at: string;
};

type StoreInsights = {
  views_30d: number;
  unique_viewers_30d: number;
  cart_adds_30d: number;
  orders_30d: number;
  completed: number;
  completed_30d?: number;
  rejected: number;
  rejected_30d?: number;
  cancelled: number;
  cancelled_30d?: number;
  open_orders: number;
  out_for_delivery: number;
  ready: number;
  preparing: number;
  unanswered: number;
  credit_available: number;
  credit_reserved: number;
  products: ProductRow[];
  demand: SearchDemandInput[];
  searches?: SearchDemandInput[];
  enquiries_30d?: number;
  catalog_searches_30d?: number;
  settled_revenue?: number;
  settled_revenue_30d?: number;
  is_available?: boolean;
  vacation_mode?: boolean;
  recent_orders?: RecentOrder[];
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border border-r-2 bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function searchHint(row: { matched_your_listings: boolean; no_results: boolean }): string {
  if (row.matched_your_listings) return 'Matched your listings';
  if (row.no_results) return 'No listing matched';
  return 'Found other listings';
}

export function StoreInsightsPanel({ sellerId }: { sellerId: string }) {
  const { formatPrice } = useCurrency();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['seller-store-insights', sellerId],
    enabled: Boolean(sellerId),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [baseRes, moreRes] = await Promise.all([
        supabase.rpc('seller_store_insights' as never, { p_seller_id: sellerId } as never),
        supabase.rpc('seller_store_insights_more' as never, { p_seller_id: sellerId } as never),
      ]);
      if (baseRes.error) throw baseRes.error;
      const more = moreRes.error ? {} : (moreRes.data || {});
      return stripBuyerIdentity({ ...(baseRes.data as object), ...(more as object) }) as StoreInsights;
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-3 text-sm text-muted-foreground">
          Store activity is not available right now.
        </CardContent>
      </Card>
    );
  }

  const products = Array.isArray(data.products) ? data.products : [];
  const clusteredSearches = clusterSearchDemand(
    Array.isArray(data.searches) && data.searches.length > 0 ? data.searches : data.demand,
  );
  const completed30d = num(data.completed_30d ?? data.completed);
  const cancelled30d = num(data.cancelled_30d ?? data.cancelled);
  const rejected30d = num(data.rejected_30d ?? data.rejected);
  const settled30d = num(data.settled_revenue_30d ?? data.settled_revenue);
  const recentOrders = Array.isArray(data.recent_orders) ? data.recent_orders : [];

  const storeState = data.vacation_mode
    ? 'Store is on vacation'
    : data.is_available === false
      ? 'Store is unavailable'
      : 'Store is available';

  return (
    <div className="space-y-4">
      <Card className="border border-border border-r-2">
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Store activity - last 30 days
          </p>
          <p className="text-[11px] text-muted-foreground">
            {storeState}
            {num(data.views_30d) > 0
              ? ` - ${conversionPercent(num(data.cart_adds_30d), num(data.views_30d))}% of views added to cart`
              : ''}
            {num(data.cart_adds_30d) > 0
              ? ` - ${conversionPercent(num(data.orders_30d), num(data.cart_adds_30d))}% of cart adds became orders`
              : ''}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Views" value={num(data.views_30d)} />
            <Stat label="Unique viewers" value={num(data.unique_viewers_30d)} />
            <Stat label="Cart adds" value={num(data.cart_adds_30d)} />
            <Stat label="Orders" value={num(data.orders_30d)} />
            <Stat label="Enquiries" value={num(data.enquiries_30d)} />
            <Stat label="People who searched your listings" value={num(data.catalog_searches_30d)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border border-r-2">
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Orders right now
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Open" value={num(data.open_orders)} />
            <Stat label="Preparing" value={num(data.preparing)} />
            <Stat label="Ready" value={num(data.ready)} />
            <Stat label="Out for delivery" value={num(data.out_for_delivery)} />
            <Stat label="Unanswered" value={num(data.unanswered)} />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-1">
            Orders - last 30 days
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Completed" value={completed30d} />
            <Stat label="Cancelled" value={cancelled30d} />
            <Stat label="Rejected" value={rejected30d} />
            <Stat label="Settled revenue" value={formatPrice(settled30d)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sociva credit available {num(data.credit_available)} - reserved {num(data.credit_reserved)}
          </p>
        </CardContent>
      </Card>

      {recentOrders.length > 0 && (
        <Card className="border border-border border-r-2">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Recent orders
            </p>
            {recentOrders.map((order, index) => (
              <div key={`${order.created_at}-${index}`} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0 last:pb-0 text-sm">
                <span className="capitalize">{String(order.status || '').replace(/_/g, ' ')}</span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {formatPrice(num(order.total_amount))}
                  {order.created_at
                    ? ` - ${formatDistanceToNowStrict(new Date(order.created_at), { addSuffix: true })}`
                    : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border border-border border-r-2">
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Your listings - last 30 days
          </p>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products yet.</p>
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <div key={product.product_id} className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-b-0 last:pb-0 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {num(product.views)} views - {num(product.unique_viewers)} people - {num(product.cart_adds)} cart - {num(product.orders)} orders
                      {conversionPercent(num(product.cart_adds), num(product.views)) != null
                        ? ` - ${conversionPercent(num(product.cart_adds), num(product.views))}% view to cart`
                        : ''}
                    </p>
                  </div>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    {product.last_viewed_at
                      ? formatDistanceToNowStrict(new Date(product.last_viewed_at), { addSuffix: true })
                      : 'No views'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {clusteredSearches.length > 0 && (
        <Card className="border border-border border-r-2">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Who searched nearby - last 30 days
            </p>
            <p className="text-[11px] text-muted-foreground">
              Queries related to your listings. Partial typing like biry and biryan is grouped into one search.
            </p>
            {clusteredSearches.map((row) => (
              <div key={row.search_term} className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-b-0 last:pb-0 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{row.search_term}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {searchHint(row)}
                    {row.aliases.length > 0 ? ` - also typed ${row.aliases.slice(0, 3).join(', ')}` : ''}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {num(row.unique_users)} {num(row.unique_users) === 1 ? 'person' : 'people'}
                  {num(row.searches) > num(row.unique_users) ? ` - ${num(row.searches)} searches` : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
