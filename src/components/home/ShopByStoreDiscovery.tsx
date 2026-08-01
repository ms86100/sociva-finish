// @ts-nocheck
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  useLocalSellers,
  useNearbySocietySellers,
  type LocalSeller,
  type NearbySeller,
  type DistanceBand,
  type SocietyGroup,
} from '@/hooks/queries/useStoreDiscovery';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, ChevronDown, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { staggerContainer, cardEntrance } from '@/lib/motion-variants';
import { RichSellerCard } from './RichSellerCard';

/* ── Main Component ── */

export function ShopByStoreDiscovery({ sectionTitle }: { sectionTitle?: string }) {
  const { effectiveSociety, profile } = useAuth();
  const browseBeyond = profile?.browse_beyond_community ?? true;
  const radiusKm = profile?.search_radius_km ?? 10;
  const { data: localGrouped = {}, isLoading: loadingLocal } = useLocalSellers();
  const { data: nearbyBands = [], isLoading: loadingNearby } = useNearbySocietySellers(radiusKm, browseBeyond);

  // Collect local seller IDs for deduplication
  const localSellerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sellers of Object.values(localGrouped)) {
      for (const s of sellers) ids.add(s.id);
    }
    return ids;
  }, [localGrouped]);

  // Filter nearby bands to remove sellers already shown in local section
  const dedupedBands = useMemo(() => {
    if (localSellerIds.size === 0) return nearbyBands;
    return nearbyBands.map(band => ({
      ...band,
      societies: band.societies.map(society => {
        const filteredGroups: Record<string, NearbySeller[]> = {};
        for (const [group, sellers] of Object.entries(society.sellersByGroup)) {
          const filtered = sellers.filter(s => !localSellerIds.has(s.seller_id));
          if (filtered.length > 0) filteredGroups[group] = filtered;
        }
        return { ...society, sellersByGroup: filteredGroups };
      }).filter(society => Object.keys(society.sellersByGroup).length > 0),
    })).filter(band => band.societies.length > 0);
  }, [nearbyBands, localSellerIds]);

  const hasLocal = Object.keys(localGrouped).length > 0;
  const hasNearby = dedupedBands.length > 0;

  if (!loadingLocal && !loadingNearby && !hasLocal && !hasNearby) return null;

  const localSectionLabel = effectiveSociety ? 'In Your Society' : 'Stores Near You';

  return (
    <div className="py-2 mt-1">
      {sectionTitle && (
        <div className="flex items-center gap-2 px-4 mb-3">
          <h3 className="font-extrabold text-lg text-foreground tracking-tight">{sectionTitle}</h3>
        </div>
      )}
      <div className="space-y-5">
      {/* ━━━ In Your Society / Stores Near You ━━━ */}
      {(loadingLocal || hasLocal) && (
        <section>
          <div className="flex items-center gap-2 px-4 mb-2.5">
            <Building2 size={16} className="text-primary" />
            <h3 className="font-bold text-sm text-foreground">
              {localSectionLabel}
              {effectiveSociety?.name && (
                <span className="font-normal text-muted-foreground ml-1">
                  – {effectiveSociety.name}
                </span>
              )}
            </h3>
          </div>

          {loadingLocal ? (
            <LocalSkeleton />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-3"
            >
              {Object.entries(localGrouped).map(([group, sellers]) => (
                <motion.div key={group} variants={cardEntrance}>
                  <CategorySellerRow groupLabel={group} sellers={sellers} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </section>
      )}

      {/* ━━━ Nearby Societies ━━━ */}
      {(loadingNearby || hasNearby) && (
        <section>
          <div className="flex items-center gap-2 px-4 mb-2.5">
            <MapPin size={16} className="text-primary" />
            <h3 className="font-bold text-sm text-foreground">Nearby Societies</h3>
          </div>

          {loadingNearby ? (
            <NearbySkeleton />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-3"
            >
              {dedupedBands.map(band => (
                <motion.div key={band.label} variants={cardEntrance}>
                  <DistanceBandSection band={band} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}

/* ── Distance Band (collapsible) ── */

function DistanceBandSection({ band }: { band: DistanceBand }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 px-4 w-full text-left">
        <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">
          {band.label}
        </span>
        <ChevronDown
          size={14}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2.5 mt-2">
        {band.societies.map(society => (
          <SocietyCard key={society.societyName} society={society} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ── Format distance ── */

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km * 10) / 10} km`;
}

/* ── Society Card ── */

function SocietyCard({ society }: { society: SocietyGroup }) {
  const allSellers = Object.entries(society.sellersByGroup).flatMap(([, sellers]) => sellers);

  return (
    <div className="mx-4 rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 bg-secondary flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">{society.societyName}</span>
        <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {formatDistance(society.distanceKm)}
        </span>
      </div>
      <div className="p-2">
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
          {allSellers.map(seller => (
            <RichSellerCard
              key={seller.seller_id}
              id={seller.seller_id}
              name={seller.business_name}
              profileImage={seller.profile_image_url}
              coverImage={seller.cover_image_url}
              categories={seller.categories}
              topProducts={seller.topProducts}
              totalReviews={seller.total_reviews}
              isFeatured={seller.is_featured}
              compact
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Category Seller Row (local sellers) ── */

function CategorySellerRow({
  groupLabel,
  sellers,
}: {
  groupLabel: string;
  sellers: LocalSeller[];
}) {
  return (
    <div>
      <div className="px-4 mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full capitalize">
          {groupLabel.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">
        {sellers.map(seller => (
          <RichSellerCard
            key={seller.id}
            id={seller.id}
            name={seller.business_name}
            profileImage={seller.profile_image_url}
            coverImage={seller.cover_image_url}
            categories={seller.categories}
            topProducts={seller.topProducts}
            totalReviews={seller.total_reviews}
            isFeatured={seller.is_featured}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Skeletons ── */

function LocalSkeleton() {
  return (
    <div className="px-4 space-y-3">
      {[1, 2].map(i => (
        <div key={i}>
          <Skeleton className="h-4 w-16 mb-2 rounded-full" />
          <div className="flex gap-2.5">
            {[1, 2, 3].map(j => (
              <Skeleton key={j} className="w-[156px] h-44 rounded-2xl shrink-0" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NearbySkeleton() {
  return (
    <div className="px-4 space-y-3">
      <Skeleton className="h-5 w-24 rounded-full" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-5 w-24 rounded-full" />
      <Skeleton className="h-44 w-full rounded-xl" />
    </div>
  );
}
