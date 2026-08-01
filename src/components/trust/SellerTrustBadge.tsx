// @ts-nocheck
import { Shield, ShieldCheck, Award, Crown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useSellerTrustTier } from '@/hooks/queries/useSellerTrustTier';

export type TrustTier = 'new' | 'tried' | 'trusted' | 'favorite';

interface SellerTrustBadgeProps {
  sellerId: string;
  size?: 'sm' | 'md';
  className?: string;
}

const ICON_MAP: Record<string, typeof Shield> = {
  Shield,
  ShieldCheck,
  Award,
  Crown,
};

const COLOR_MAP: Record<string, { color: string; bg: string }> = {
  muted: { color: 'text-muted-foreground', bg: 'bg-muted' },
  blue: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  primary: { color: 'text-primary', bg: 'bg-primary/10' },
  amber: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
};

/**
 * @deprecated Use sellerId prop instead.
 */
export function getSellerTrustTier(completedOrders: number, rating: number): TrustTier {
  if (completedOrders >= 100 && rating >= 4.5) return 'favorite';
  if (completedOrders >= 50) return 'trusted';
  if (completedOrders >= 5) return 'tried';
  return 'new';
}

export function SellerTrustBadge({ sellerId, size = 'sm', className }: SellerTrustBadgeProps) {
  const { data: tier } = useSellerTrustTier(sellerId);

  if (!tier) return null;

  const Icon = ICON_MAP[tier.icon_name] || Shield;
  const colors = COLOR_MAP[tier.badge_color] || COLOR_MAP.muted;

  if (size === 'sm') {
    return (
      <Badge
        variant="secondary"
        className={cn(
          'text-[9px] px-1.5 py-0 h-4 border-0 font-semibold gap-0.5',
          colors.bg, colors.color,
          className
        )}
      >
        <Icon size={9} className="shrink-0" />
        {tier.tier_label}
      </Badge>
    );
  }

  return (
    <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold', colors.bg, colors.color, className)}>
      <Icon size={14} />
      <span>{tier.tier_label}</span>
    </div>
  );
}
