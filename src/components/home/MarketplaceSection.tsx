// @ts-nocheck
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useNavigate } from 'react-router-dom';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { useProductFacets } from '@/hooks/queries/useProductFacets';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useSocialProof } from '@/hooks/queries/useSocialProof';
import { ParentGroupTabs } from '@/components/home/ParentGroupTabs';
import { CategoryImageGrid } from '@/components/home/CategoryImageGrid';
import { FeaturedBanners } from '@/components/home/FeaturedBanners';
import { FestivalBannerModule } from '@/components/home/FestivalBannerModule';
import { useActiveFestivals, useFestivalTakeover, FESTIVAL_TAB_VALUE } from '@/hooks/queries/useActiveFestivals';
import { AutoHighlightStrip } from '@/components/home/AutoHighlightStrip';
import { BuyAgainRow } from '@/components/home/BuyAgainRow';
import { ShopByStoreDiscovery } from '@/components/home/ShopByStoreDiscovery';
import { NearbySellersSection } from '@/components/marketplace/NearbySellersSection';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { LazySection } from '@/components/home/LazySection';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { GroupedSellerRow } from '@/components/home/GroupedSellerRow';
import { ProductCardSkeleton } from '@/components/product/ProductCardSkeleton';
import { ShoppingBag, Sparkles, Flame, UtensilsCrossed, Wrench, Heart, Users } from 'lucide-react';
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
import { isFoodParentGroup } from '@/lib/food-facets';
import { useSellerContext } from '@/contexts/auth/contexts';
import { pickSellerJourneyStore } from '@/lib/seller-journey';

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

  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [commerceFacets, setCommerceFacets] = useState<CommerceFacetState>(emptyCommerceFacetState());
  const { festivals } = useActiveFestivals();
  const takeover = useFestivalTakeover();
  const festivalTabs = useMemo(
    () => festivals.slice(0, 1).map((f) => ({
      value: FESTIVAL_TAB_VALUE,
      label: f.banner.title || 'Festival',
    })),
    [festivals],
  );
  const isFestivalTab = activeGroup === FESTIVAL_TAB_VALUE;

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const { configs: categoryConfigs } = useCategoryConfigs();
  useMarketplaceConfig();
  useBadgeConfig();

  // Cap discovery payload — 80 products was overkill for first paint
  const { data: localCategories = [], isLoading: loadingLocal } = useProductsByCategory(40);
  const { parentGroupInfos } = useParentGroups();

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
    if (!activeGroup) return allProducts;
    return allProducts.filter((p) => {
      const group = (p as any).parentGroup;
      if (group === activeGroup) return true;
      if (isFoodParentGroup(activeGroup) && (isFoodParentGroup(group) || isFoodParentGroup(p.category))) return true;
      return false;
    });
  }, [allProducts, activeGroup]);

  const dynamicFacetChips = useMemo(
    () => extractAvailableCommerceFacets(scopedProducts, { parentGroup: activeGroup, currentState: commerceFacets }),
    [scopedProducts, activeGroup, commerceFacets]
  );

  const isFacetFilterActive = hasActiveCommerceFacets(commerceFacets);

  const facetFilteredProducts = useMemo(() => {
    if (!isFacetFilterActive) return [];
    return scopedProducts.filter((p) => productMatchesCommerceFacets(p, commerceFacets));
  }, [isFacetFilterActive, scopedProducts, commerceFacets]);

  const discoveryIntents = useMemo(
    () => (isFestivalTab ? [] : buildDiscoveryIntents(localCategoriesWithFacets, { activeGroup })),
    [isFestivalTab, localCategoriesWithFacets, activeGroup],
  );

  // Social proof only after scroll / idle — never blocks first paint
  const [socialProofReady, setSocialProofReady] = useState(false);
  useEffect(() => {
    if (allProductIds.length === 0) return;
    const timer = setTimeout(() => setSocialProofReady(true), 3500);
    return () => clearTimeout(timer);
  }, [allProductIds.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocialProof(socialProofReady ? allProductIds : []);

  const newThisWeekDays = ml.threshold('new_this_week_days');
  const discoveryMaxItems = ml.threshold('discovery_max_items');

  const popularNearYou = useMemo(() => {
    return [...allProducts]
      .sort((a, b) => ((b as any).completed_order_count || 0) - ((a as any).completed_order_count || 0))
      .slice(0, discoveryMaxItems || 10);
  }, [allProducts, discoveryMaxItems]);

  const newThisWeek = useMemo(() => {
    const cutoff = Date.now() - (newThisWeekDays || 7) * 24 * 60 * 60 * 1000;
    const popularIds = new Set(popularNearYou.map(p => p.id));
    return allProducts
      .filter(p => new Date(p.created_at).getTime() >= cutoff && !popularIds.has(p.id))
      .slice(0, discoveryMaxItems || 10);
  }, [allProducts, newThisWeekDays, discoveryMaxItems, popularNearYou]);

  const activeCategorySet = new Set(localCategories.map(c => c.category));
  const activeParentGroupSet = new Set(localCategories.map(c => c.parentGroup));

  const activeParentGroups = isFestivalTab
    ? []
    : activeGroup
      ? parentGroupInfos.filter(g => g.value === activeGroup && activeParentGroupSet.has(g.value))
      : parentGroupInfos.filter(g => activeParentGroupSet.has(g.value));

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    const catConfig = categoryConfigs.find(c => c.category === product.category);
    setSelectedProduct({
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image_url: product.image_url,
      is_veg: product.is_veg,
      category: product.category,
      description: product.description,
      prep_time_minutes: product.prep_time_minutes,
      fulfillment_mode: product.fulfillment_mode,
      delivery_note: product.delivery_note,
      action_type: product.action_type,
      contact_phone: product.contact_phone,
      specifications: product.specifications || null,
      seller_id: product.seller_id,
      seller_name: product.seller_name || '',
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      seller_verified: !!(product as any).seller_verified,
      society_name: (product as any).society_name || null,
      distance_km: (product as any).distance_km ?? null,
      is_same_society: (product as any).is_same_society ?? true,
      delivery_time_text: (product as any).delivery_time_text || null,
      last_active_at: (product as any).last_active_at ?? null,
      _catIcon: catConfig?.icon || '🛍️',
      _catName: catConfig?.displayName || product.category,
    });
    setDetailOpen(true);
  }, [categoryConfigs]);

  if (!loadingLocal && localCategories.length === 0) {
    return (
      <div className="pb-2">
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
              { icon: <UtensilsCrossed size={20} className="text-warning" />, bg: 'bg-warning/10', title: 'Home-cooked meals', desc: 'Fresh food from your neighbors' },
              { icon: <Wrench size={20} className="text-primary" />, bg: 'bg-primary/10', title: 'Local services', desc: 'Trusted help nearby' },
              { icon: <Heart size={20} className="text-destructive" />, bg: 'bg-destructive/10', title: 'Zero commission', desc: 'Sellers keep 100%' },
            ].map((card) => (
              <div
                key={card.title}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-card border border-border text-center"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', card.bg)}>
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
      {/* Above-fold: categories first (Blinkit shop-first), then products */}
      <div
        className="pt-1 pb-1"
        style={takeover.active ? { backgroundColor: takeover.bg } : undefined}
      >
        <ParentGroupTabs
          activeGroup={activeGroup}
          onGroupChange={(g) => {
            setActiveGroup(g);
            setCommerceFacets(emptyCommerceFacetState());
          }}
          activeParentGroups={activeParentGroupSet}
          festivalTabs={festivalTabs}
        />
      </div>

      {!isFestivalTab && (
        <CommerceFacetRail
          value={commerceFacets}
          onChange={setCommerceFacets}
          chips={dynamicFacetChips}
          parentGroup={activeGroup}
          className="py-1"
        />
      )}

      {!isFestivalTab && <DiscoveryChipRail intents={discoveryIntents} />}

      {isFacetFilterActive && (
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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

      {(!activeGroup || isFestivalTab) && festivals.map((f) => (
        <FestivalBannerModule
          key={f.banner.id}
          banner={f.banner}
          sections={f.sections}
          onProductTap={handleProductTap}
          categoryConfigs={categoryConfigs}
        />
      ))}

      {!isFestivalTab && (loadingLocal ? (
        <div className="px-4 mt-2">
          <ProductCardSkeleton count={6} />
        </div>
      ) : (
        <div>
          {activeParentGroups.map((group) => (
            <CategoryImageGrid
              key={group.value}
              parentGroup={group.value}
              title={group.label}
              activeCategories={activeCategorySet}
            />
          ))}
        </div>
      ))}

      {/* Above-fold products — shop-first density after categories */}
      {!activeGroup && !loadingLocal && popularNearYou.length > 0 && (
        <>
          <SectionDivider />
          <GroupedSellerRow
            title={browsingLocation?.label ? `${ml.label('label_discovery_popular')} · ${browsingLocation.label}` : ml.label('label_discovery_popular')}
            icon={<Flame size={15} className="text-destructive" />}
            products={popularNearYou}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
            seeAllLink="/discovery/popular"
          />
        </>
      )}

      {!activeGroup && !loadingLocal && newThisWeek.length > 0 && (
        <>
          <SectionDivider />
          <GroupedSellerRow
            title={ml.label('label_discovery_new')}
            icon={<Sparkles size={15} className="text-primary" />}
            products={newThisWeek}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
            seeAllLink="/discovery/new"
          />
        </>
      )}

      {/* Promos + deferred strips after shop surface */}
      {!isFestivalTab && (
        <LazySection>
          <FeaturedBanners />
        </LazySection>
      )}

      {!isFestivalTab && (
        <LazySection>
          <AutoHighlightStrip />
        </LazySection>
      )}

      {!activeGroup && !isFestivalTab && (
        <LazySection>
          <BuyAgainRow />
        </LazySection>
      )}

      {!isFestivalTab && (
        <LazySection>
          <SectionDivider />
          <ShopByStoreDiscovery sectionTitle={ml.label('label_section_store_discovery')} />
        </LazySection>
      )}

      {!isFestivalTab && (
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
              const catConfig = categoryConfigs.find(c => c.category === sp.category);
              setSelectedProduct({
                product_id: sp.id,
                product_name: sp.name,
                price: sp.price,
                image_url: sp.image_url,
                is_veg: sp.is_veg ?? true,
                category: sp.category,
                description: sp.description || null,
                seller_id: sp.seller_id,
                seller_name: sp.seller?.business_name || '',
                seller_rating: 0,
                seller_reviews: 0,
                action_type: sp.action_type,
                _catIcon: catConfig?.icon || '🛍️',
                _catName: catConfig?.displayName || sp.category,
              });
            }}
            categoryIcon={selectedProduct?._catIcon}
            categoryName={selectedProduct?._catName}
          />
        </Suspense>
      )}
    </div>
  );
}
