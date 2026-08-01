// @ts-nocheck
import { CheckCircle, Clock, Users, TrendingUp, ShieldCheck, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSellerTrustSnapshot, type SellerTrustSnapshot } from '@/hooks/queries/useProductTrustMetrics';

interface SellerStatsCardProps {
  sellerId: string;
}

export function SellerStatsCard({ sellerId }: SellerStatsCardProps) {
  const { data: trust, isLoading } = useSellerTrustSnapshot(sellerId);

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }

  if (!trust || trust.completed_orders === 0) return null;

  const denom = trust.completed_orders + trust.cancelled_orders;
  const fulfillmentRate = denom > 0 ? Math.round((trust.completed_orders / denom) * 100) : null;

  const stats = [
    ...(fulfillmentRate !== null ? [{
      icon: CheckCircle,
      label: 'Fulfillment',
      value: `${fulfillmentRate}%`,
      color: 'text-success',
    }] : []),
    {
      icon: Users,
      label: 'Repeat Buyers',
      value: `${Math.round(trust.repeat_customer_pct)}%`,
      color: 'text-primary',
    },
    {
      icon: Clock,
      label: 'Avg Response',
      value: trust.avg_response_min > 0 ? `${Math.round(trust.avg_response_min)} min` : '—',
      color: 'text-amber-500',
    },
    {
      icon: TrendingUp,
      label: 'Last 30 Days',
      value: `${trust.recent_order_count} orders`,
      color: 'text-blue-500',
    },
  ];

  return (
    <Card className="border-primary/15 bg-primary/5">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <ShieldCheck size={14} className="text-primary" />
          <span className="text-xs font-bold text-primary">Seller Trust Snapshot</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-2 bg-background rounded-lg px-2.5 py-2">
              <stat.icon size={14} className={stat.color} />
              <div>
                <p className="text-xs font-bold leading-none">{stat.value}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
