// @ts-nocheck
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useNavigate } from 'react-router-dom';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { useProductFacets } from '@/hooks/queries/useProductFacets';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useSocialProof } from '@/hooks/queries/useSocialProof';
import { ParentGroupTabs } from '@/components/home/ParentGroupTabs';
import { CategoryImageGrid } from '@/components/home/CategoryImageGrid';
import { FeaturedBanners } from '@/components/home/FeaturedBanners';
import { FestivalBannerModule } from '@/components/home/FestivalBannerModule';
import { FestivalHomeHero } from '@/components/home/FestivalHomeHero';
import { useActiveFestivals, useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import { BuyAgainRow } from '@/components/home/BuyAgainRow';
import { ShopByStoreDiscovery } from '@/components/home/ShopByStoreDiscovery';
import { NearbySellersSection } from '@/components/marketplace/NearbySellersSection';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { LazySection } from '@/components/home/LazySection';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { GroupedSellerRow } from '@/components/home/GroupedSellerRow';
import { ProductCardSkeleton } from '@/components/product/ProductCardSkeleton';
import { ShoppingBag, Flame, UtensilsCrossed, Wrench, Heart, Users } from 'lucide-react';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { useBadgeConfig } from '@/hooks/useBadgeConfig';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { cn } from '@/lib/utils';
import { DiscoveryChipRail } from '@/components/home/DiscoveryChipRail';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { buildDiscoveryIntents } from '@/lib/discovery-intents';
import { applyProductFacetRow } from '@/hooks/queries/useProductFacets';
import {
  CommerceFacetState,
  emptyCommerceFacetState,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
  extractAvailableCommerceFacets,
} from '@/lib/commerce-facets';
import { useSellerContext } from '@/contexts/auth/contexts';
import { pickSellerJourneyStore } from '@/lib/seller-journey';
import { buildProductDetailPayload, buildRelatedProductDetailPayload } from '@/lib/product-detail-payload';
import { CommerceModeTiles, countListingsByMode } from '@/components/home/CommerceModeTiles';

function getPublicOrigin() {
  const origin = window.location.origin || '';
  if (
    !origin ||
    origin.includes('localhost') ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('https://localhost')
  ) {
    return 'https://www.sociva.in';
  }
  return origin;
}

async function inviteNeighborToSell() {
  const inviteUrl = `${getPublicOrigin()}/#/become-seller`;
  const shareText = `I'm using Sociva to buy and sell with neighbors. Start selling in our community:\n${inviteUrl}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Start selling on Sociva',
        text: shareText,
        url: inviteUrl,
      });
      return;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showFeedback({
      title: 'Invite link copied',
      description: 'Share it on WhatsApp so your neighbor can start selling',
      variant: 'success',
    });
  } catch {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  }
}

// Keep recharts / booking / enquiry sheets off the Home critical path
const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);
function SectionDivider() {
  return <div className="my-1" />;
}

export function MarketplaceSection() {
  const navigate = useNavigate();
  const ml = useMarketplaceLabels();
  const { browsingLocation } = useBrowsingLocation();
  const { sellerProfiles } = useSellerContext();
  const sellerAttention = pickSellerJourneyStore(sellerProfiles);
  const emptyMarketplacePrimary = useMemo(() => {
    if (sellerAttention?.status === 'pending') {
      return { label: 'Finish store details', href: '/seller' };
    }
    if (sellerAttention?.status === 'rejected') {
      return { label: 'Update & resubmit store', href: '/become-seller' };
    }
    if (sellerAttention?.status === 'approved') {
      return { label: 'Open Seller Dashboard', href: '/seller' };
    }
    const hasDraft = (sellerProfiles || []).some((p: any) => p.verification_status === 'draft');
    if (hasDraft) {
      return { label: 'Continue store setup', href: '/become-seller' };
    }
    return { label: 'Start selling to your neighbors', href: '/become-seller' };
  }, [sellerAttention, sellerProfiles]);

  /** Leaf category slug (Home Food etc.) - preferred sticky rail, shared with Search. */
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [festivalFocused, setFestivalFocused] = useState(false);
  const [commerceFacets, setCommerceFacets] = useState<CommerceFacetState>(emptyCommerceFacetState());
  const { festivals } = useActiveFestivals();
  const takeover = useFestivalTakeover();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const { configs: categoryConfigs } = useCategoryConfigs();
  useMarketplaceConfig();
  useBadgeConfig();

  // Cap discovery payload - 80 products was overkill for first paint
  const { data: localCategories = [], isLoading: loadingLocal } = useProductsByCategory(40);
  const { data: marketplaceSellers = [] } = useMarketplaceData();
  const { parentGroupInfos } = useParentGroups();

  const activeCategoryConfig = useMemo(
    () => (activeCategory ? categoryConfigs.find((c) => c.category === activeCategory) : null),
    [activeCategory, categoryConfigs],
  );
  /** Parent group derived from selected leaf - used for facets / food scoping only. */
  const activeGroup = activeCategoryConfig?.parentGroup ?? null;

  const allProductsRaw = useMemo(() => localCategories.flatMap(c => c.products), [localCategories]);
  const allProductIds = useMemo(() => allProductsRaw.map(p => p.id), [allProductsRaw]);
  const { data: facetRows = {} } = useProductFacets(allProductIds, allProductIds.length > 0);
  const localCategoriesWithFacets = useMemo(() => localCategories.map((group) => ({
    ...group,
    products: group.products.map((p) => applyProductFacetRow({ ...p, parentGroup: group.parentGroup }, facetRows[p.id])),
  })), [localCategories, facetRows]);
  const allProducts = useMemo(
    () => localCategoriesWithFacets.flatMap((c) => c.products),
    [localCategoriesWithFacets],
  );

  const scopedProducts = useMemo(() => {
    if (activeCategory) {
      return allProducts.filter((p) => p.category === activeCategory);
    }
    return allProducts;
  }, [allProducts, activeCategory]);

  const dynamicFacetChips = useMemo(
    () => extractAvailableCommerceFacets(scopedProducts, { parentGroup: activeGroup, currentState: commerceFacets, categoryConfigs }),
    [scopedProducts, activeGroup, commerceFacets, categoryConfigs]
  );

  const isFacetFilterActive = hasActiveCommerceFacets(commerceFacets);

  const facetFilteredProducts = useMemo(() => {
    if (!isFacetFilterActive) return [];
    return scopedProducts.filter((p) => productMatchesCommerceFacets(p, commerceFacets, categoryConfigs));
  }, [isFacetFilterActive, scopedProducts, commerceFacets, categoryConfigs]);

  const discoveryIntents = useMemo(
    () => (festivalFocused ? [] : buildDiscoveryIntents(localCategoriesWithFacets, { activeGroup })),
    [festivalFocused, localCategoriesWithFacets, activeGroup],
  );

  // Social proof only after scroll / idle - never blocks first paint
  const [socialProofReady, setSocialProofReady] = useState(false);
  useEffect(() => {
    if (allProductIds.length === 0) return;
    const timer = setTimeout(() => setSocialProofReady(true), 3500);
    return () => clearTimeout(timer);
  }, [allProductIds.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocialProof(socialProofReady ? allProductIds : []);

  const discoveryMaxItems = ml.threshold('discovery_max_items');

  const popularNearYou = useMemo(() => {
    return [...allProducts]
      .sort((a, b) => ((b as any).completed_order_count || 0) - ((a as any).completed_order_count || 0))
      .slice(0, discoveryMaxItems || 10);
  }, [allProducts, discoveryMaxItems]);

  const modeCounts = useMemo(() => {
    const loaded = marketplaceSellers.flatMap((seller) =>
      Array.isArray(seller.matching_products) ? seller.matching_products : [],
    );
    return countListingsByMode(loaded, categoryConfigs);
  }, [marketplaceSellers, categoryConfigs]);

  const activeCategorySet = useMemo(
    () => new Set(localCategories.map((c) => c.category)),
    [localCategories],
  );
  const activeParentGroupSet = useMemo(
    () => new Set(localCategories.map((c) => c.parentGroup)),
    [localCategories],
  );

  const activeParentGroups = festivalFocused
    ? []
    : activeCategory && activeCategoryConfig
      ? parentGroupInfos.filter(
          (g) => g.value === activeCategoryConfig.parentGroup && activeParentGroupSet.has(g.value),
        )
      : parentGroupInfos.filter((g) => activeParentGroupSet.has(g.value));

  const gridActiveCategories = useMemo(() => {
    if (activeCategory) return new Set([activeCategory]);
    return activeCategorySet;
  }, [activeCategory, activeCategorySet]);

  const exploreFestival = useCallback(() => {
    setFestivalFocused(true);
    setCommerceFacets(emptyCommerceFacetState());
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('festival-home-destination')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  }, []);

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    setSelectedProduct(buildProductDetailPayload(product, categoryConfigs));
    setDetailOpen(true);
  }, [categoryConfigs]);

  if (!loadingLocal && localCategories.length === 0) {
    return (
      <div className="pb-2">
        <div className="pt-2 pb-1">
          <CommerceModeTiles counts={modeCounts} />
        </div>
        {festivals.map((f) => (
          <FestivalBannerModule
            key={f.banner.id}
            banner={f.banner}
            sections={f.sections}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
          />
        ))}
        <LazySection>
          <FeaturedBanners />
        </LazySection>
        <div className="px-4 py-10 space-y-8">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="relative w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                <ShoppingBag size={40} className="text-primary" />
              </div>
            </div>
            <h2 className="text-xl font-extrabold text-foreground tracking-tight">{ml.label('label_empty_marketplace_title')}</h2>
            <p className="text-sm text-muted-foreground max-w-xs mt-2 leading-relaxed">
              {ml.label('label_empty_marketplace_desc')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { icon: <UtensilsCrossed size={20} />, well: 'bg-mode-shop/15 text-mode-shop-ink', title: 'Home-cooked meals', desc: 'Fresh food from your neighbors' },
              { icon: <Wrench size={20} />, well: 'bg-mode-services/15 text-mode-services-ink', title: 'Local services', desc: 'Trusted help nearby' },
              { icon: <Heart size={20} />, well: 'bg-offer/15 text-offer-ink', title: 'Zero commission', desc: 'Sellers keep 100%' },
            ].map((card) => (
              <div
                key={card.title}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-card border border-border text-center"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', card.well)}>
                  {card.icon}
                </div>
                <p className="text-[11px] font-bold text-foreground leading-tight">{card.title}</p>
                <p className="text-[9px] text-muted-foreground leading-snug">{card.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Users size={14} />
            <span>Join families already using Sociva in their community</span>
          </div>

          <div className="flex flex-col gap-2 max-w-xs mx-auto">
            <button
              onClick={() => navigate(emptyMarketplacePrimary.href)}
              className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              {emptyMarketplacePrimary.label}
            </button>
            <button
              onClick={() => { inviteNeighborToSell(); }}
              className="w-full px-4 py-3 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium active:scale-[0.98] transition-transform"
            >
              Invite a neighbor to sell
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-2">
      {/* Above-fold: festival hero (when active), mode tiles, category rail, then products */}
      <div
        className="pt-1 pb-1"
        style={takeover.active ? { backgroundColor: takeover.bg } : undefined}
      >
        {takeover.active && (
          <FestivalHomeHero onExplore={exploreFestival} />
        )}
        <div className="pt-1 pb-1">
          <CommerceModeTiles counts={modeCounts} />
        </div>
        <ParentGroupTabs
          activeCategory={activeCategory}
          onCategoryChange={(cat) => {
            setActiveCategory(cat);
            setFestivalFocused(false);
            setCommerceFacets(emptyCommerceFacetState());
          }}
          activeCategories={activeCategorySet}
        />
      </div>

      {!festivalFocused && (
        <CommerceFacetRail
          value={commerceFacets}
          onChange={setCommerceFacets}
          chips={dynamicFacetChips}
          parentGroup={activeGroup}
          className="py-1"
          inventory={scopedProducts}
        />
      )}

      {isFacetFilterActive && !festivalFocused && (
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-foreground">
                Filtered Results ({facetFilteredProducts.length})
              </p>
              <p className="text-xs text-muted-foreground">
                {commerceFacets.veg ? 'Veg · ' : ''}
                {commerceFacets.openNow ? 'Open Now · ' : ''}
                {commerceFacets.actionType ? `${commerceFacets.actionType} · ` : ''}
                {commerceFacets.serviceMode ? `${commerceFacets.serviceMode} · ` : ''}
                {commerceFacets.durationMax ? `≤ ${commerceFacets.durationMax} min · ` : ''}
                {commerceFacets.priceMax ? `≤ ₹${commerceFacets.priceMax} · ` : ''}
                {[commerceFacets.meal, commerceFacets.cuisine, commerceFacets.course].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              onClick={() => setCommerceFacets(emptyCommerceFacetState())}
              className="text-xs text-primary font-semibold hover:underline"
            >
              Clear filters
            </button>
          </div>
          {facetFilteredProducts.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
              {facetFilteredProducts.map((product) => (
                <ProductListingCard
                  key={product.id}
                  product={product}
                  onTap={handleProductTap}
                  onNavigate={navigate}
                  categoryConfigs={categoryConfigs as any}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-muted/40 text-center border border-dashed border-border">
              <p className="text-sm font-medium text-foreground">No listings matching active filters</p>
              <button
                onClick={() => setCommerceFacets(emptyCommerceFacetState())}
                className="mt-2 text-xs text-primary font-semibold hover:underline"
              >
                Reset filters
              </button>
            </div>
          )}
          <SectionDivider />
        </div>
      )}

      {!activeCategory && !festivalFocused && !loadingLocal && popularNearYou.length > 0 && (
        <div data-testid="home-popular-rail">
          <SectionDivider />
          <GroupedSellerRow
            title={browsingLocation?.label ? `${ml.label('label_discovery_popular')} · ${browsingLocation.label}` : ml.label('label_discovery_popular')}
            icon={<Flame size={15} className="text-destructive" />}
            products={popularNearYou}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
            seeAllLink="/discovery/popular"
          />
        </div>
      )}

      {!festivalFocused && !activeCategory && <DiscoveryChipRail intents={discoveryIntents} />}

      {(!activeCategory || festivalFocused) && festivals.length > 0 && (
        <div id="festival-home-destination" className="scroll-mt-28">
          {festivals.map((f) => (
            <FestivalBannerModule
              key={f.banner.id}
              banner={f.banner}
              sections={f.sections}
              onProductTap={handleProductTap}
              categoryConfigs={categoryConfigs}
            />
          ))}
        </div>
      )}

      {!festivalFocused && (loadingLocal ? (
        <div className="px-4 mt-2">
          <ProductCardSkeleton count={6} />
        </div>
      ) : (
        <div>
          {activeParentGroups.map((group) => (
            <CategoryImageGrid
              key={group.value}
              parentGroup={group.value}
              title={activeCategoryConfig?.displayName || group.label}
              activeCategories={gridActiveCategories}
            />
          ))}
        </div>
      ))}

      {/* Promos sit under the category grids so the product rail stays above the fold. */}
      {!festivalFocused && (
        <LazySection>
          <FeaturedBanners />
        </LazySection>
      )}

      {!activeCategory && !festivalFocused && (
        <LazySection>
          <BuyAgainRow />
        </LazySection>
      )}

      {!festivalFocused && (
        <LazySection>
          <SectionDivider />
          <ShopByStoreDiscovery sectionTitle={ml.label('label_section_store_discovery')} />
        </LazySection>
      )}

      {!festivalFocused && (
        <LazySection>
          <NearbySellersSection />
        </LazySection>
      )}

      {detailOpen && (
        <Suspense fallback={null}>
          <ProductDetailSheet
            product={selectedProduct}
            open={detailOpen}
            onOpenChange={setDetailOpen}
            onSelectProduct={(sp) => {
              setSelectedProduct(buildRelatedProductDetailPayload(sp, categoryConfigs));
            }}
            categoryIcon={selectedProduct?._catIcon}
            categoryName={selectedProduct?._catName}
          />
        </Suspense>
      )}
    </div>
  );
}
