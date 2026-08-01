// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Search } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface DemandInsightsProps {
  societyId?: string | null;
  sellerId?: string | null;
}

export function DemandInsights({ societyId, sellerId }: DemandInsightsProps) {
  const ml = useMarketplaceLabels();
  const maxItems = ml.threshold('demand_insights_max_items');

  const { data, isLoading } = useQuery({
    queryKey: ['unmet-demand', societyId ?? 'none', sellerId ?? 'none'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_unmet_demand' as any, {
        _society_id: societyId || null,
        _seller_id: sellerId || null,
      });
      if (error) throw error;
      return (data || []) as { search_term: string; search_count: number; last_searched: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
          <TrendingUp size={12} className="text-primary" /> {ml.label('label_demand_insights_title')}
        </p>
        <div className="space-y-2">
          {data.slice(0, maxItems || 5).map((item) => (
            <div key={item.search_term} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 truncate">
                <Search size={12} className="text-muted-foreground shrink-0" />
                <span className="truncate">"{item.search_term}"</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold text-primary">{item.search_count} searches</span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNowStrict(new Date(item.last_searched), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          {ml.label('label_demand_insights_empty')}
        </p>
      </CardContent>
    </Card>
  );
}
