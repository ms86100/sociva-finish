// @ts-nocheck
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';

export type PerformanceLevel = 'top' | 'needs_attention' | 'new' | null;

interface ProductPerformanceBadgeProps {
  level: PerformanceLevel;
}

export function ProductPerformanceBadge({ level }: ProductPerformanceBadgeProps) {
  if (!level) return null;

  switch (level) {
    case 'top':
      return (
        <Badge className="bg-success/20 text-success text-[10px] px-1 gap-0.5">
          <TrendingUp size={10} /> Top Performer
        </Badge>
      );
    case 'needs_attention':
      return (
        <Badge className="bg-warning/20 text-warning-foreground text-[10px] px-1 gap-0.5">
          <AlertTriangle size={10} /> Needs Attention
        </Badge>
      );
    case 'new':
      return (
        <Badge variant="secondary" className="text-[10px] px-1 gap-0.5">
          <Sparkles size={10} /> New
        </Badge>
      );
    default:
      return null;
  }
}

export function getPerformanceLevel(
  product: { id: string; created_at: string },
  orderCounts: Record<string, number>,
  allProducts: { id: string; created_at: string }[],
): PerformanceLevel {
  const createdAt = new Date(product.created_at);
  const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // New: less than 7 days old
  if (daysSinceCreation < 7) return 'new';

  const myOrders = orderCounts[product.id] || 0;

  // Needs attention: 0 orders in 14+ days
  if (daysSinceCreation >= 14 && myOrders === 0) return 'needs_attention';

  // Top performer: top 20% by orders (minimum 1 order)
  if (myOrders > 0 && allProducts.length >= 3) {
    const sorted = allProducts
      .map(p => orderCounts[p.id] || 0)
      .sort((a, b) => b - a);
    const top20Index = Math.max(0, Math.ceil(sorted.length * 0.2) - 1);
    const threshold = sorted[top20Index] || 1;
    if (myOrders >= threshold) return 'top';
  }

  return null;
}
