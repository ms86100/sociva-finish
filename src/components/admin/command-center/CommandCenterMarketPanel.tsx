import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Overview = {
  views_30d: number;
  cart_adds_30d: number;
  searches_30d: number;
  zero_result_searches_30d: number;
  onboarding_started: number;
  pending_stores: number;
  active_users_30d?: number;
  new_users_30d?: number;
  active_sellers?: number;
  orders_today?: number;
  revenue_30d?: number;
};

type ProductDemand = {
  product_id: string;
  name: string;
  price: number | null;
  store_name: string;
  views: number;
  unique_viewers: number;
  cart_adds: number;
  orders: number;
};

type SearchRow = {
  search_term: string;
  searches: number;
  unique_users: number;
  no_results: boolean;
  opportunity?: boolean;
  orders_followed?: number;
};

type ViewerRow = {
  name: string | null;
  phone: string | null;
  viewed_at: string;
  platform: string | null;
};

type DirectoryRow = {
  seller_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  store_name: string;
  stage: string;
  products: number;
  views: number;
  cart_adds: number;
  orders: number;
  open_orders: number;
  unanswered: number;
  credit_available: number;
};

type SearchPerson = {
  name: string | null;
  phone: string | null;
  searched_at: string;
  results_count: number;
  platform: string | null;
};

type AcquisitionRow = {
  name: string | null;
  phone: string | null;
  store_name: string;
  platform: string;
  last_active_at: string;
  stage: string;
  abandoned_stage: string | null;
};

type ActiveRow = {
  name: string | null;
  phone: string | null;
  platform: string | null;
  actions: string;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, (args || {}) as never);
  if (error) throw error;
  return data as T;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function CommandCenterMarketPanel() {
  const [term, setTerm] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['admin-market-overview'],
    queryFn: () => rpc<Overview>('admin_market_overview'),
    staleTime: 60 * 1000,
  });
  const products = useQuery({
    queryKey: ['admin-product-demand'],
    queryFn: () => rpc<ProductDemand[]>('admin_product_demand', { p_limit: 15 }),
    staleTime: 60 * 1000,
  });
  const searches = useQuery({
    queryKey: ['admin-search-intelligence'],
    queryFn: () => rpc<SearchRow[]>('admin_search_intelligence', { p_limit: 15 }),
    staleTime: 60 * 1000,
  });
  const people = useQuery({
    queryKey: ['admin-search-people', term],
    enabled: Boolean(term),
    queryFn: () => rpc<SearchPerson[]>('admin_search_people', { p_term: term }),
  });
  const acquisition = useQuery({
    queryKey: ['admin-seller-acquisition'],
    queryFn: () => rpc<AcquisitionRow[]>('admin_seller_acquisition'),
    staleTime: 60 * 1000,
  });
  const active = useQuery({
    queryKey: ['admin-active-since-yesterday'],
    queryFn: () => rpc<ActiveRow[]>('admin_active_since_yesterday'),
    staleTime: 60 * 1000,
  });
  const directory = useQuery({
    queryKey: ['admin-seller-directory'],
    queryFn: () => rpc<DirectoryRow[]>('admin_seller_directory'),
    staleTime: 60 * 1000,
  });
  const funnel = useQuery({
    queryKey: ['admin-seller-funnel'],
    queryFn: () => rpc<Record<string, number>>('admin_seller_funnel'),
    staleTime: 60 * 1000,
  });
  const viewers = useQuery({
    queryKey: ['admin-product-viewers', productId],
    enabled: Boolean(productId),
    queryFn: () => rpc<ViewerRow[]>('admin_product_viewers', { p_product_id: productId }),
  });

  const overviewData = overview.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Marketplace - last 30 days</p>
          {overview.isLoading ? <Skeleton className="h-16 w-full" /> : overview.isError || !overviewData ? (
            <p className="text-sm text-muted-foreground">Overview is not available.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Product views" value={num(overviewData.views_30d)} />
              <Stat label="Cart adds" value={num(overviewData.cart_adds_30d)} />
              <Stat label="Searches" value={num(overviewData.searches_30d)} />
              <Stat label="No-result searches" value={num(overviewData.zero_result_searches_30d)} />
              <Stat label="Onboarding started" value={num(overviewData.onboarding_started)} />
              <Stat label="Pending stores" value={num(overviewData.pending_stores)} />
              <Stat label="Active users" value={num(overviewData.active_users_30d)} />
              <Stat label="New users" value={num(overviewData.new_users_30d)} />
              <Stat label="Active sellers" value={num(overviewData.active_sellers)} />
              <Stat label="Orders today" value={num(overviewData.orders_today)} />
              <Stat label="Settled revenue" value={num(overviewData.revenue_30d)} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product demand</p>
          {products.isLoading ? <Skeleton className="h-16 w-full" /> : (products.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No product views in the last 30 days.</p>
          ) : (products.data || []).map((row) => (
            <button
              key={row.product_id}
              type="button"
              className="w-full flex items-start justify-between gap-3 text-sm text-left hover:bg-accent/40 rounded-md px-1 py-1"
              onClick={() => setProductId(row.product_id)}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{row.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{row.store_name}</p>
              </div>
              <p className="text-[11px] text-muted-foreground shrink-0 text-right">
                {num(row.views)} views - {num(row.unique_viewers)} people
                <br />
                {num(row.cart_adds)} cart - {num(row.orders)} orders
              </p>
            </button>
          ))}
          {productId && (
            <div className="mt-2 border-t border-border pt-2 space-y-1">
              <p className="text-[11px] font-semibold">Who viewed this product</p>
              {viewers.isLoading ? <Skeleton className="h-8 w-full" /> : (viewers.data || []).map((person, index) => (
                <p key={`${person.phone}-${index}`} className="text-xs text-muted-foreground">
                  {person.name || 'Unnamed'} - {person.phone || 'no phone'} - {person.platform || 'unknown'} - {person.viewed_at ? format(new Date(person.viewed_at), 'd MMM, h:mm a') : ''}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Search</p>
          {searches.isLoading ? <Skeleton className="h-16 w-full" /> : (searches.data || []).map((row) => (
            <button
              key={row.search_term}
              type="button"
              className="w-full flex items-center justify-between gap-3 text-sm text-left hover:bg-accent/40 rounded-md px-1 py-1"
              onClick={() => setTerm(row.search_term)}
            >
              <span className="truncate">
                {row.search_term}
                {row.no_results ? ' - no results' : ''}
                {row.opportunity ? ' - opportunity' : ''}
                {num(row.orders_followed) > 0 ? ` - ${num(row.orders_followed)} orders followed` : ''}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">{num(row.unique_users)} people</span>
            </button>
          ))}
          {term && (
            <div className="mt-2 border-t border-border pt-2 space-y-1">
              <p className="text-[11px] font-semibold">Who searched "{term}"</p>
              {people.isLoading ? <Skeleton className="h-8 w-full" /> : (people.data || []).map((person, index) => (
                <p key={`${person.phone}-${person.searched_at}-${index}`} className="text-xs text-muted-foreground">
                  {person.name || 'Unnamed'} - {person.phone || 'no phone'} - {person.platform || 'unknown'} - {person.searched_at ? format(new Date(person.searched_at), 'd MMM, h:mm a') : ''} - {num(person.results_count)} results
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Seller acquisition</p>
          {funnel.data && (
            <p className="text-[11px] text-muted-foreground">
              {Object.entries(funnel.data).map(([stage, count]) => `${stage} ${count}`).join(' - ')}
            </p>
          )}
          {acquisition.isLoading ? <Skeleton className="h-16 w-full" /> : (acquisition.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No onboarding attempts recorded yet. New attempts appear after the next app open.</p>
          ) : (acquisition.data || []).map((row, index) => (
            <div key={`${row.phone}-${index}`} className="text-sm">
              <p className="font-medium">{row.name || 'Unnamed'} - {row.phone || 'no phone'}</p>
              <p className="text-[11px] text-muted-foreground">
                {row.store_name || 'No store'} - {row.stage}{row.abandoned_stage ? ` - left at ${row.abandoned_stage}` : ''} - {row.platform || 'unknown'}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Stores</p>
          {directory.isLoading ? <Skeleton className="h-16 w-full" /> : (directory.data || []).map((row) => (
            <div key={row.seller_id} className="text-sm">
              <p className="font-medium">{row.store_name || 'Untitled'} - {row.owner_name || 'Unnamed'} - {row.owner_phone || 'no phone'}</p>
              <p className="text-[11px] text-muted-foreground">
                {row.stage} - {num(row.products)} products - {num(row.views)} views - {num(row.cart_adds)} cart - {num(row.orders)} orders - {num(row.open_orders)} open - {num(row.unanswered)} unanswered - credit {num(row.credit_available)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active since yesterday</p>
          {active.isLoading ? <Skeleton className="h-16 w-full" /> : (active.data || []).map((row, index) => (
            <div key={`${row.phone}-${index}`} className="text-sm">
              <p className="font-medium">{row.name || 'Unnamed'} - {row.phone || 'no phone'} - {row.platform || 'unknown'}</p>
              <p className="text-[11px] text-muted-foreground">{row.actions}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
