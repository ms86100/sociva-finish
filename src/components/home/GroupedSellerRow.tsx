// @ts-nocheck
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { RichSellerCard } from './RichSellerCard';
import { useParentGroups } from '@/hooks/useParentGroups';
import type { TopProduct } from '@/hooks/queries/useStoreDiscovery';

interface GroupedSellerRowProps {
  title: string;
  icon?: React.ReactNode;
  products: ProductWithSeller[];
  onProductTap?: (p: ProductWithSeller) => void;
  categoryConfigs?: any[];
  seeAllLink?: string;
  subtitle?: string;
  sellerImages?: ReadonlyMap<string, { profileImage: string | null; coverImage: string | null }>;
  /** Maximum sellers to render in the row */
  maxSellers?: number;
  /** Maximum top products per seller card */
  maxProductsPerSeller?: number;
  tone?: 'default' | 'festival';
  accentColor?: string;
}

interface SellerGroup {
  sellerId: string;
  sellerName: string;
  categories: string[];
  primaryGroup: string | null;
  groupLabel: string | null;
  totalReviews: number;
  isFeatured: boolean;
  topProducts: TopProduct[];
  /** Original products for tap-through */
  productMap: Map<string, ProductWithSeller>;
}

export function GroupedSellerRow({
  title,
  icon,
  products,
  onProductTap,
  categoryConfigs = [],
  seeAllLink,
  subtitle,
  sellerImages,
  maxSellers = 12,
  maxProductsPerSeller = 2,
  tone = 'default',
  accentColor,
}: GroupedSellerRowProps) {
  const { parentGroupInfos } = useParentGroups();

  const groups = useMemo<SellerGroup[]>(() => {
    const map = new Map<string, SellerGroup>();
    for (const p of products) {
      if (!p.seller_id) continue;
      const cfg = categoryConfigs.find(c => c.category === p.category);
      const parentGroup = cfg?.parentGroup || cfg?.parent_group || (p as any).parentGroup || null;
      const groupInfo = parentGroupInfos.find(g => g.value === parentGroup);
      const groupLabel = groupInfo?.label || (parentGroup ? String(parentGroup).replace(/_/g, ' ') : null);

      let g = map.get(p.seller_id);
      if (!g) {
        g = {
          sellerId: p.seller_id,
          sellerName: p.seller_name || '',
          categories: [],
          primaryGroup: parentGroup,
          groupLabel,
          totalReviews: (p as any).seller_reviews || 0,
          isFeatured: !!(p as any).seller_verified,
          topProducts: [],
          productMap: new Map(),
        };
        map.set(p.seller_id, g);
      }
      if (p.category && !g.categories.includes(p.category)) g.categories.push(p.category);
      if (!g.primaryGroup && parentGroup) g.primaryGroup = parentGroup;
      if (!g.groupLabel && groupLabel) g.groupLabel = groupLabel;
      if (g.topProducts.length < maxProductsPerSeller) {
        g.topProducts.push({
          id: p.id,
          name: p.name,
          price: p.price,
          image_url: p.image_url,
          category: p.category,
          is_veg: p.is_veg ?? null,
          mrp: (p as any).mrp ?? null,
          discount_percentage: (p as any).discount_percentage ?? null,
          action_type: p.action_type ?? null,
        });
      }
      g.productMap.set(p.id, p);
    }
    return Array.from(map.values()).slice(0, maxSellers);
  }, [products, categoryConfigs, parentGroupInfos, maxSellers, maxProductsPerSeller]);

  if (groups.length === 0) return null;

  const resolvedGroups = groups
    .map(g => g.primaryGroup)
    .filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);
  const fallbackLink = resolvedGroups.length === 1 ? `/category/${resolvedGroups[0]}` : '/categories';
  const finalSeeAllLink = seeAllLink || fallbackLink;

  const festival = tone === 'festival';
  const storeCount = groups.length;
  const span = storeCount === 1 ? 'fill' : storeCount === 2 ? 'pair' : 'grid';
  const rowClass = storeCount >= 3
    ? 'grid grid-cols-3 gap-2 px-4 pb-2 items-stretch'
    : storeCount === 2
      ? 'grid grid-cols-2 gap-2.5 px-4 pb-2 items-stretch'
      : 'px-4 pb-2';

  return (
    <div>
      <div className="flex items-center justify-between px-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <div className="min-w-0">
            <h3 className={cn(
              'font-extrabold text-lg tracking-tight truncate',
              festival ? 'text-white' : 'text-foreground'
            )}>{title}</h3>
            {subtitle && !festival && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {finalSeeAllLink && (
          <Link
            to={finalSeeAllLink}
            className={cn(
              'text-xs font-bold flex items-center gap-0.5 hover:underline',
              !festival && 'text-primary'
            )}
            style={festival ? { color: accentColor || '#f5d76e' } : undefined}
          >
            See all <ChevronRight size={14} />
          </Link>
        )}
      </div>
      <motion.div
        className={rowClass}
        initial="hidden"
        animate="show"
        variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}
      >
        {groups.map(g => (
          <motion.div
            key={g.sellerId}
            className="min-w-0 h-full"
            variants={{ hidden: { opacity: 0, y: 12, scale: 0.97 }, show: { opacity: 1, y: 0, scale: 1 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            <RichSellerCard
              id={g.sellerId}
              name={g.sellerName}
              profileImage={sellerImages?.get(g.sellerId)?.profileImage ?? null}
              coverImage={sellerImages?.get(g.sellerId)?.coverImage ?? null}
              categories={g.categories}
              topProducts={g.topProducts}
              totalReviews={g.totalReviews}
              isFeatured={g.isFeatured}
              groupLabel={span === 'grid' ? null : g.groupLabel}
              compact
              span={span}
              onProductTap={
                onProductTap
                  ? (tp) => {
                      const original = g.productMap.get(tp.id);
                      if (original) onProductTap(original);
                    }
                  : undefined
              }
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
