// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, XCircle, ShieldCheck, Clock, TrendingUp } from 'lucide-react';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface SellerReputationTabProps {
  sellerId: string;
}

interface ReputationSummary {
  total_events: number;
  positive_events: number;
  negative_events: number;
  fulfillment_rate: number;
  recent_events: {
    event_type: string;
    is_positive: boolean;
    occurred_at: string;
  }[];
}

const ICON_MAP: Record<string, typeof CheckCircle> = {
  order_completed: CheckCircle,
  order_cancelled: XCircle,
  dispute_resolved: ShieldCheck,
  dispute_lost: XCircle,
  response_fast: Clock,
  response_slow: Clock,
};

export function SellerReputationTab({ sellerId }: SellerReputationTabProps) {
  const ml = useMarketplaceLabels();
  const eventLabelsMap = ml.reputationEventLabels();

  const { data, isLoading } = useQuery({
    queryKey: ['seller-reputation', sellerId],
    queryFn: async (): Promise<ReputationSummary> => {
      const { data: events } = await supabase
        .from('seller_reputation_ledger')
        .select('event_type, is_positive, occurred_at')
        .eq('seller_id', sellerId)
        .order('occurred_at', { ascending: false })
        .limit(100);

      const all = events || [];
      const positive = all.filter(e => e.is_positive).length;
      const negative = all.filter(e => !e.is_positive).length;
      const total = all.length;
      const fulfillmentRate = total > 0 ? Math.round((positive / total) * 100) : 100;

      return {
        total_events: total,
        positive_events: positive,
        negative_events: negative,
        fulfillment_rate: fulfillmentRate,
        recent_events: all.slice(0, 10),
      };
    },
    enabled: !!sellerId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="space-y-3 p-4"><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>;
  }

  if (!data || data.total_events === 0) {
    return (
      <div className="text-center py-8">
        <ShieldCheck className="mx-auto text-muted-foreground mb-2" size={28} />
        <p className="text-sm text-muted-foreground">{ml.label('label_reputation_empty')}</p>
        <p className="text-xs text-muted-foreground mt-1">{ml.label('label_reputation_empty_desc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp size={16} className="mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{data.fulfillment_rate}%</p>
            <p className="text-[10px] text-muted-foreground">Fulfillment</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <CheckCircle size={16} className="mx-auto text-success mb-1" />
            <p className="text-lg font-bold">{data.positive_events}</p>
            <p className="text-[10px] text-muted-foreground">Positive</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <XCircle size={16} className="mx-auto text-destructive mb-1" />
            <p className="text-lg font-bold">{data.negative_events}</p>
            <p className="text-[10px] text-muted-foreground">Issues</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card>
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Recent Activity</p>
          <div className="space-y-2">
            {data.recent_events.map((event, i) => {
              const config = eventLabelsMap[event.event_type] || { label: event.event_type, color: 'text-muted-foreground' };
              const Icon = ICON_MAP[event.event_type] || Clock;
              const timeAgo = new Date(event.occurred_at);
              const diffHours = (Date.now() - timeAgo.getTime()) / (1000 * 60 * 60);
              const timeLabel = diffHours < 1 ? 'Just now' : diffHours < 24 ? `${Math.floor(diffHours)}h ago` : `${Math.floor(diffHours / 24)}d ago`;

              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Icon size={12} className={config.color} />
                    <span className="text-xs">{config.label}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
