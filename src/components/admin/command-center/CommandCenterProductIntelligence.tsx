// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Search, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNowStrict } from 'date-fns';

const AMPLITUDE_DASHBOARD_URL =
  String(import.meta.env.VITE_AMPLITUDE_DASHBOARD_URL || 'https://app.amplitude.com/')
    .replace(/^["']|["']$/g, '')
    .trim() || 'https://app.amplitude.com/';

const FUNNEL_LINKS = [
  {
    title: 'First Order Funnel',
    hint: 'search → product → cart → checkout → order',
    href: AMPLITUDE_DASHBOARD_URL,
  },
  {
    title: 'Seller Onboarding Funnel',
    hint: 'step_started → completed / abandoned / validation_failed (v5 4-step)',
    href: AMPLITUDE_DASHBOARD_URL,
  },
  {
    title: 'Push → Order Funnel',
    hint: 'push opened → product → checkout → order_completed',
    href: AMPLITUDE_DASHBOARD_URL,
  },
  {
    title: 'Top Searches',
    hint: 'Amplitude chart + society demand below',
    href: AMPLITUDE_DASHBOARD_URL,
  },
  {
    title: 'Cart → Checkout drop-off',
    hint: 'cart_opened → checkout_started → order_completed',
    href: AMPLITUDE_DASHBOARD_URL,
  },
];

/**
 * Thin Product Intelligence panel: Amplitude deep links + Supabase-native top searches.
 * Does not clone Amplitude data into Postgres.
 */
export function CommandCenterProductIntelligence({
  societyId,
}: {
  societyId?: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['cc-top-searches', societyId ?? 'all'],
    queryFn: async () => {
      // Prefer unmet-demand RPC (aggregates search_demand_log) when scoped;
      // fall back to recent committed searches from search_demand_log.
      if (societyId) {
        const { data: unmet, error } = await supabase.rpc('get_unmet_demand' as any, {
          _society_id: societyId,
          _seller_id: null,
        });
        if (!error && unmet?.length) {
          return (unmet as { search_term: string; search_count: number; last_searched: string }[]).slice(0, 10);
        }
      }

      let q = supabase
        .from('search_demand_log')
        .select('search_term, searched_at, results_count')
        .order('searched_at', { ascending: false })
        .limit(200);
      if (societyId) q = q.eq('society_id', societyId);
      const { data: rows, error } = await q;
      if (error) throw error;

      const counts = new Map<string, { search_term: string; search_count: number; last_searched: string }>();
      for (const row of rows || []) {
        const term = String(row.search_term || '').trim().toLowerCase();
        if (!term) continue;
        const prev = counts.get(term);
        if (prev) {
          prev.search_count += 1;
          if (row.searched_at > prev.last_searched) prev.last_searched = row.searched_at;
        } else {
          counts.set(term, {
            search_term: term,
            search_count: 1,
            last_searched: row.searched_at,
          });
        }
      }
      return Array.from(counts.values())
        .sort((a, b) => b.search_count - a.search_count)
        .slice(0, 10);
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <BarChart3 size={12} /> Product Intelligence
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Behaviour funnels live in Amplitude. Top searches below come from Sociva&apos;s search_demand_log.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FUNNEL_LINKS.map((link) => (
          <Card key={link.title} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-semibold">{link.title}</p>
              <p className="text-[11px] text-muted-foreground">{link.hint}</p>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-8 rounded-xl text-xs w-full"
              >
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  Open in Amplitude <ExternalLink size={12} className="ml-1" />
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1">
            <Search size={12} /> Top searches (Supabase)
          </p>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full rounded-lg" />
              ))}
            </div>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No search demand logged yet{societyId ? ' for this society' : ''}.
            </p>
          ) : (
            <div className="space-y-2">
              {data.map((item) => (
                <div
                  key={item.search_term}
                  className="flex items-center justify-between text-sm gap-2"
                >
                  <span className="truncate">"{item.search_term}"</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-primary">
                      {item.search_count}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(item.last_searched), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
