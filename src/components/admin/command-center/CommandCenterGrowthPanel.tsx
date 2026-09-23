// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommandCenterGrowthSnapshot } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';

export function CommandCenterGrowthPanel({
  data,
  isLoading,
}: {
  data?: CommandCenterGrowthSnapshot | null;
  isLoading?: boolean;
}) {
  const { formatPrice } = useCurrency();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Growth snapshot unavailable.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Growth snapshot
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GrowthCard
          label="Buyers"
          primary={`${data.buyers?.new_30d ?? 0} new (30d)`}
          secondary={`${data.buyers?.with_order_30d ?? 0} ordered · ${data.buyers?.new_7d ?? 0} new (7d)`}
        />
        <GrowthCard
          label="Sellers"
          primary={`${data.sellers?.new_30d ?? 0} new (30d)`}
          secondary={`${data.sellers?.pending ?? 0} pending · ${data.sellers?.approved_7d ?? 0} approved (7d)`}
        />
        <GrowthCard
          label="Orders"
          primary={`${data.orders?.placed_30d ?? 0} placed (30d)`}
          secondary={`${data.orders?.placed_7d ?? 0} this week · GMV ${formatPrice(data.orders?.gmv_30d ?? 0)}`}
        />
        <GrowthCard
          label="Listings"
          primary={`${data.listings?.live ?? 0} live`}
          secondary={`${data.listings?.pending ?? 0} awaiting approval`}
        />
      </div>
    </div>
  );
}

function GrowthCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-4">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">
          {label}
        </p>
        <p className="text-sm font-bold mt-1">{primary}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{secondary}</p>
      </CardContent>
    </Card>
  );
}
