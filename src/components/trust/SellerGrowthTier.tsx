// @ts-nocheck
import { Badge } from '@/components/ui/badge';
import { Sprout, Store, Award, Crown } from 'lucide-react';
import { useSellerTrustTier } from '@/hooks/queries/useSellerTrustTier';

interface Props {
  sellerId: string;
}

const ICON_MAP: Record<string, typeof Sprout> = {
  Sprout,
  Store,
  Award,
  Crown,
};

const COLOR_MAP: Record<string, string> = {
  muted: 'bg-muted text-muted-foreground',
  blue: 'bg-primary/10 text-primary',
  primary: 'bg-success/10 text-success',
  amber: 'bg-amber-100 text-amber-700',
};

export function SellerGrowthTier({ sellerId }: Props) {
  const { data: tier } = useSellerTrustTier(sellerId);

  if (!tier || !tier.growth_label) return null;

  const Icon = ICON_MAP[tier.growth_icon || ''] || Sprout;
  const color = COLOR_MAP[tier.badge_color] || COLOR_MAP.muted;

  return (
    <div className="space-y-1">
      <Badge className={`${color} border-0 text-[10px] gap-1`}>
        <Icon size={10} />
        {tier.growth_label}
      </Badge>
    </div>
  );
}
