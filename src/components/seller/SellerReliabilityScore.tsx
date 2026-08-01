// @ts-nocheck
import { useSellerReliability } from '@/hooks/queries/useSellerReliability';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, Truck, Clock, Users, Star, XCircle } from 'lucide-react';

interface Props {
  sellerId: string;
}

const DIMENSIONS = [
  { key: 'fulfillment_score', label: 'Fulfillment', icon: ShieldCheck, color: 'text-primary' },
  { key: 'ontime_score', label: 'On-Time', icon: Truck, color: 'text-success' },
  { key: 'response_score', label: 'Response', icon: Clock, color: 'text-accent' },
  { key: 'retention_score', label: 'Retention', icon: Users, color: 'text-primary' },
  { key: 'rating_score', label: 'Rating', icon: Star, color: 'text-warning' },
  { key: 'cancellation_score', label: 'Low Cancel', icon: XCircle, color: 'text-destructive' },
] as const;

function getScoreLabel(score: number) {
  if (score >= 85) return { text: 'Excellent', className: 'text-success' };
  if (score >= 70) return { text: 'Good', className: 'text-primary' };
  if (score >= 50) return { text: 'Average', className: 'text-warning' };
  return { text: 'Needs Improvement', className: 'text-destructive' };
}

export function SellerReliabilityScore({ sellerId }: Props) {
  const { data, isLoading } = useSellerReliability(sellerId);

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (!data || data.total_orders === 0) {
    return null;
  }

  const label = getScoreLabel(data.overall_score);

  return (
    <Card className="mb-2">
      <CardContent className="p-4 space-y-3">
        {/* Overall Score */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />
            <span className="text-sm font-semibold">Reliability Score</span>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold">{data.overall_score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
            <p className={`text-[10px] font-medium ${label.className}`}>{label.text}</p>
          </div>
        </div>

        {/* Progress bar */}
        <Progress value={data.overall_score} className="h-2" />

        {/* Dimension breakdown */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {DIMENSIONS.map(({ key, label, icon: Icon, color }) => (
            <div key={key} className="text-center">
              <Icon size={12} className={`mx-auto mb-0.5 ${color}`} />
              <p className="text-xs font-bold">{Math.round(data[key])}</p>
              <p className="text-[9px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          Based on {data.total_orders} orders · {data.completed_orders} completed
        </p>
      </CardContent>
    </Card>
  );
}
