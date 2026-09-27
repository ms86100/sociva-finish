import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { conversionPercent, stripBuyerIdentity } from '@/lib/marketplace-intelligence';

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

type DemandRow = {
  search_term: string;
  unique_users: number;
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
  rejected: number;
  cancelled: number;
  open_orders: number;
  out_for_delivery: number;
  ready: number;
  preparing: number;
  unanswered: number;
  credit_available: number;
  credit_reserved: number;
  products: ProductRow[];
  demand: DemandRow[];
  enquiries_30d?: number;
  catalog_searches_30d?: number;
  settled_revenue?: number;
  is_available?: boolean;
  vacation_mode?: boolean;
  recent_orders?: RecentOrder[];
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function StoreInsightsPanel({ sellerId }: { sellerId: string }) {
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
  const demand = Array.isArray(data.demand) ? data.demand : [];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Store activity - last 30 days
          </p>
          <p className="text-[11px] text-muted-foreground">
            {data.vacation_mode ? 'Store is on vacation' : data.is_available === false ? 'Store is unavailable' : 'Store is available'}
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
            <Stat label="Catalog searches" value={num(data.catalog_searches_30d)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Orders</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Completed" value={num(data.completed)} />
            <Stat label="Rejected" value={num(data.rejected)} />
            <Stat label="Cancelled" value={num(data.cancelled)} />
            <Stat label="Open" value={num(data.open_orders)} />
            <Stat label="Preparing" value={num(data.preparing)} />
            <Stat label="Ready" value={num(data.ready)} />
            <Stat label="Out for delivery" value={num(data.out_for_delivery)} />
            <Stat label="Unanswered" value={num(data.unanswered)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Settled revenue {num(data.settled_revenue)} - Sociva credit available {num(data.credit_available)} - reserved {num(data.credit_reserved)}
          </p>
          {Array.isArray(data.recent_orders) && data.recent_orders.length > 0 && (
            <div className="space-y-1">
              {data.recent_orders.map((order, index) => (
                <div key={`${order.created_at}-${index}`} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{order.status}</span>
                  <span className="text-xs text-muted-foreground">{num(order.total_amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Products</p>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products yet.</p>
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <div key={product.product_id} className="flex items-start justify-between gap-3 text-sm">
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

      {demand.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Searches with no results
            </p>
            {demand.map((row) => (
              <div key={row.search_term} className="flex items-center justify-between text-sm">
                <span className="truncate">{row.search_term}</span>
                <span className="text-xs text-muted-foreground shrink-0">{num(row.unique_users)} people</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
