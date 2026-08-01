// @ts-nocheck
import { TrendingUp } from 'lucide-react';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { useTrendingProducts } from '@/hooks/queries/useTrendingProducts';
import type { MarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import type { BadgeConfigRow } from '@/hooks/useBadgeConfig';
import type { CategoryConfig } from '@/types/categories';

interface TrendingInSocietyProps {
  onProductTap?: (p: ProductWithSeller) => void;
  onNavigate?: (path: string) => void;
  categoryConfigs?: CategoryConfig[];
  marketplaceConfig?: MarketplaceConfig;
  badgeConfigs?: BadgeConfigRow[];
  socialProofMap?: Map<string, number>;
}

export function TrendingInSociety({
  onProductTap, onNavigate, categoryConfigs, marketplaceConfig, badgeConfigs, socialProofMap,
}: TrendingInSocietyProps) {
  const { data: trending = [] } = useTrendingProducts(10);

  if (trending.length < 3) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-4 mb-3">
        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <TrendingUp size={13} className="text-primary" />
        </div>
        <h3 className="font-bold text-[14px] text-foreground tracking-tight">
          Trending near you
        </h3>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-2 snap-x snap-mandatory items-stretch">
        {trending.map((product) => (
          <div key={product.id} className="w-[155px] shrink-0 snap-start flex">
            <ProductListingCard
              product={product}
              onTap={onProductTap}
              onNavigate={onNavigate}
              categoryConfigs={categoryConfigs}
              marketplaceConfig={marketplaceConfig}
              badgeConfigs={badgeConfigs}
              socialProofCount={socialProofMap?.get(product.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
