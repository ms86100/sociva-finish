// @ts-nocheck
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Store, Users, ShoppingBag } from 'lucide-react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { useCurrency } from '@/hooks/useCurrency';
import { VegBadge } from '@/components/ui/veg-badge';
import { cn } from '@/lib/utils';
import type { TopProduct } from '@/hooks/queries/useStoreDiscovery';

export function sanitizeSellerName(name: string): string {
  return /^\d+$/.test((name || '').trim()) ? '' : name;
}

export function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

export interface RichSellerCardProps {
  id: string;
  name: string;
  profileImage: string | null;
  coverImage: string | null;
  categories: string[] | null;
  topProducts: TopProduct[];
  totalReviews: number;
  isFeatured: boolean;
  groupLabel?: string | null;
  compact?: boolean;
  onProductTap?: (product: TopProduct) => void;
}

export function RichSellerCard({
  id,
  name,
  profileImage,
  coverImage,
  categories,
  topProducts,
  totalReviews,
  isFeatured,
  groupLabel,
  compact = false,
  onProductTap,
}: RichSellerCardProps) {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const sanitized = sanitizeSellerName(name);
  const hue = useMemo(() => hashToHue(id), [id]);

  const hasProducts = topProducts.length > 0;
  const minPrice = hasProducts ? Math.min(...topProducts.map(p => p.price)) : null;
  const heroImage = coverImage || (hasProducts ? topProducts[0]?.image_url : null) || profileImage;
  const isNew = totalReviews === 0;
  const cardWidth = compact ? 'w-[150px] sm:w-[160px]' : 'w-[160px] sm:w-[170px]';

  return (
    <div className="shrink-0 snap-start flex flex-col gap-1">
      {groupLabel && (
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground bg-secondary px-2 py-0.5 rounded-full self-start truncate max-w-full">
          {groupLabel}
        </span>
      )}
      <motion.div
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate(`/seller/${id}`)}
        className={cn(
          'rounded-2xl overflow-hidden cursor-pointer',
          'bg-card border border-border/60 shadow-card',
          'transition-[box-shadow,border-color,transform] duration-200 ease-out hover:shadow-elevated hover:border-border',
          cardWidth,
        )}
      >
        <div className="relative h-20 bg-muted overflow-hidden">
          {heroImage ? (
            <img
              src={optimizedImageUrl(heroImage, { width: 300, quality: 70 })}
              alt={sanitized}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={handleImageError}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-2xl font-bold text-white"
              style={{ backgroundColor: `hsl(${hue}, 55%, 50%)` }}
            >
              {sanitized.charAt(0).toUpperCase()}
            </div>
          )}

          {isFeatured && (
            <span className="absolute top-1.5 left-1.5 text-[8px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
              Verified
            </span>
          )}

          <span className="absolute bottom-1 right-1 text-[8px] font-semibold bg-background/80 backdrop-blur-sm text-foreground px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            {isNew ? (<><Store size={8} />New</>) : (<><Users size={8} />{totalReviews} reviews</>)}
          </span>
        </div>

        <div className="px-2 pt-1.5 pb-1">
          <p className="font-bold text-foreground text-[11px] leading-tight line-clamp-1">{sanitized}</p>
          {categories && categories.length > 0 && (
            <div className="flex gap-1 mt-1 overflow-hidden">
              {categories.slice(0, 2).map(cat => (
                <span
                  key={cat}
                  className="text-[8px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground truncate max-w-[60px]"
                >
                  {cat.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasProducts && (
          <div className="px-1.5 pb-2">
            <div className="flex gap-1">
              {topProducts.slice(0, 2).map(product => (
                <ProductMini
                  key={product.id}
                  product={product}
                  onTap={onProductTap ? (e) => { e.stopPropagation(); onProductTap(product); } : undefined}
                />
              ))}
            </div>
            {minPrice !== null && (
              <p className="text-[9px] font-semibold text-success mt-1 px-0.5">
                From {formatPrice(minPrice)}
              </p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function ProductMini({ product, onTap }: { product: TopProduct; onTap?: (e: React.MouseEvent) => void }) {
  const { formatPrice } = useCurrency();
  return (
    <div
      onClick={onTap}
      className={cn('flex-1 min-w-0 rounded-lg bg-muted/50 overflow-hidden', onTap && 'cursor-pointer')}
    >
      {product.image_url ? (
        <img
          src={optimizedImageUrl(product.image_url, { width: 150, quality: 70 })}
          alt={product.name}
          className="w-full h-12 object-cover"
          loading="lazy"
          decoding="async"
          onError={handleImageError}
        />
      ) : (
        <div className="w-full h-12 flex items-center justify-center bg-secondary">
          <ShoppingBag size={14} className="text-muted-foreground" />
        </div>
      )}
      <div className="px-1 py-0.5">
        <p className="text-[8px] text-foreground font-medium line-clamp-1">{product.name}</p>
        <div className="flex items-center gap-0.5">
          {product.is_veg !== null && <VegBadge isVeg={product.is_veg} size="sm" />}
          <span className="text-[8px] font-bold text-foreground">{formatPrice(product.price)}</span>
        </div>
      </div>
    </div>
  );
}
