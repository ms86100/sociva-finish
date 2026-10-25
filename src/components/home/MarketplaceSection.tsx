// @ts-nocheck
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useNavigate } from 'react-router-dom';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { useProductFacets } from '@/hooks/queries/useProductFacets';
import { useSocialProof } from '@/hooks/queries/useSocialProof';
import { isFoodListingCategory, listingMatchesCategoryChip } from '@/lib/food-facets';
import { FeaturedBanners } from '@/components/home/FeaturedBanners';
import { NeighborMakesBanner } from '@/components/home/NeighborMakesBanner';
import { FestivalBannerModule } from '@/components/home/FestivalBannerModule';
import { FestivalHomeHero } from '@/components/home/FestivalHomeHero';
import { useActiveFestivals, useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import { ShopByStoreDiscovery } from '@/components/home/ShopByStoreDiscovery';
import { NearbySellersSection } from '@/components/marketplace/NearbySellersSection';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { LazySection } from '@/components/home/LazySection';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { GroupedSellerRow } from '@/components/home/GroupedSellerRow';
import { IntentProductRail } from '@/components/discovery/IntentProductRail';
import { useIntentRailModel } from '@/hooks/useIntentRailModel';
import { ShoppingBag, Flame, UtensilsCrossed, Wrench, Heart, Users, MapPin } from 'lucide-react';
import { LoadFailureState } from '@/components/network/LoadFailureState';
import { useSlowLoading } from '@/hooks/useSlowLoading';
import { resolveMarketplaceStatus } from '@/lib/marketplace-status';
import { useAuth } from '@/contexts/AuthContext';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { useBadgeConfig } from '@/hooks/useBadgeConfig';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { cn } from '@/lib/utils';
import { DiscoveryChipRail } from '@/components/home/DiscoveryChipRail';
import { GuidedDiscoveryRail } from '@/components/home/GuidedDiscoveryRail';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { buildDiscoveryIntents } from '@/lib/discovery-intents';
import { buildGuidedDiscoveryHubs } from '@/lib/guided-discovery';
import { listingsSellingWell } from '@/lib/selling-well';
import { pickDishListingPhoto } from '@/lib/chip-listing-photo';
import { applyProductFacetRow } from '@/hooks/queries/useProductFacets';
import {
  CommerceFacetState,
  emptyCommerceFacetState,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
  extractAvailableCommerceFacets,
  omitSoleActionChips,
} from '@/lib/commerce-facets';
import { filterByMode } from '@/lib/commerce-mode';
import { useSellerContext } from '@/contexts/auth/contexts';
import { pickSellerJourneyStore } from '@/lib/seller-journey';
import { buildProductDetailPayload, buildRelatedProductDetailPayload } from '@/lib/product-detail-payload';
import { useHomeSearch } from '@/contexts/HomeSearchContext';
import { useNearbyProductSearch } from '@/hooks/queries/useNearbyProductSearch';
import { listingMatchesSearchText, stampSellerHoursFromInventory } from '@/lib/listing-search';

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
  const { query: homeQuery } = useHomeSearch();
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
  const {
    data: localCategories = [],
    isLoading: loadingLocal,
    isError: marketplaceFailed,
    isFetching: marketplaceFetching,
    isPaused: marketplacePaused,
    hasLocation,
    refetch: refetchMarketplace,
  } = useProductsByCategory(40);
  // Home is the cart catalog. Book and enquiry listings stay on their own tabs.
  const cartCategories = useMemo(() => {
    return localCategories
      .map((group) => ({
        ...group,
        products: filterByMode(group.products, 'shop', categoryConfigs),
      }))
      .filter((group) => group.products.length > 0);
  }, [localCategories, categoryConfigs]);
  const { user, profile, isProfileLoading, profileError } = useAuth();
  const marketplaceStatus = resolveMarketplaceStatus({
    hasContent: cartCategories.length > 0,
    isLoading: loadingLocal,
    hasLocation,
    // Society / saved-address coordinates arrive with the auth profile.
    locationPending: !!user && (isProfileLoading || (!profile && !profileError)),
    isPaused: marketplacePaused,
    isError: marketplaceFailed,
  });
  const showMarketplaceSkeleton = marketplaceStatus === 'loading';
  const marketplaceSlow = useSlowLoading(showMarketplaceSkeleton);
  const { data: marketplaceSellers = [] } = useMarketplaceData();
  const activeCategoryConfig = useMemo(
    () => (activeCategory ? categoryConfigs.find((c) => c.category === activeCategory) : null),
    [activeCategory, categoryConfigs],
  );
  /** Parent group derived from selected leaf - used for facets / food scoping only. */
  const activeGroup = activeCategoryConfig?.parentGroup ?? null;

  const allProductsRaw = useMemo(() => cartCategories.flatMap(c => c.products), [cartCategories]);
  const allProductIds = useMemo(() => allProductsRaw.map(p => p.id), [allProductsRaw]);
  const { data: facetRows = {} } = useProductFacets(allProductIds, allProductIds.length > 0);
  const localCategoriesWithFacets = useMemo(() => cartCategories.map((group) => ({
    ...group,
    products: group.products.map((p) => applyProductFacetRow({ ...p, parentGroup: group.parentGroup }, facetRows[p.id])),
  })), [cartCategories, facetRows]);
  const allProducts = useMemo(
    () => localCategoriesWithFacets.flatMap((c) => c.products),
    [localCategoriesWithFacets],
  );

  const scopedProducts = useMemo(() => {
    if (activeCategory) {
      return allProducts.filter((p) => listingMatchesCategoryChip(p, activeCategory));
    }
    return allProducts;
  }, [allProducts, activeCategory]);

  const queryNorm = homeQuery.trim().toLowerCase();
  const searchActive = queryNorm.length >= 2;
  const { data: ftsListings = [], isFetching: searchFetching } = useNearbyProductSearch(homeQuery);

  const searchedProducts = useMemo(() => {
    if (!searchActive) return [];
    const localHits = allProducts.filter((product) => listingMatchesSearchText(product, queryNorm));
    const byId = new Map(localHits.map((product) => [product.id, product]));
    for (const row of filterByMode(ftsListings, 'shop', categoryConfigs)) {
      if (byId.has(row.id)) continue;
      const local = allProducts.find((product) => product.id === row.id);
      byId.set(row.id, stampSellerHoursFromInventory(local || applyProductFacetRow(row, facetRows[row.id]), allProducts));
    }
    return [...byId.values()];
  }, [searchActive, queryNorm, allProducts, ftsListings, categoryConfigs, facetRows]);

  const facetInventory = searchActive ? searchedProducts : scopedProducts;

  const dynamicFacetChips = useMemo(
    () => omitSoleActionChips(extractAvailableCommerceFacets(facetInventory, { parentGroup: activeGroup, currentState: commerceFacets, categoryConfigs })),
    [facetInventory, activeGroup, commerceFacets, categoryConfigs]
  );

  const isFacetFilterActive = hasActiveCommerceFacets(commerceFacets);

  const facetFilteredProducts = useMemo(() => {
    if (!isFacetFilterActive) return [];
    return scopedProducts.filter((p) => productMatchesCommerceFacets(p, commerceFacets, categoryConfigs));
  }, [isFacetFilterActive, scopedProducts, commerceFacets, categoryConfigs]);

  const visibleSearchProducts = useMemo(() => {
    if (!searchActive) return [];
    if (!isFacetFilterActive) return searchedProducts;
    return searchedProducts.filter((product) => productMatchesCommerceFacets(product, commerceFacets, categoryConfigs));
  }, [searchActive, isFacetFilterActive, searchedProducts, commerceFacets, categoryConfigs]);

  const discoveryIntents = useMemo(
    () => buildDiscoveryIntents(localCategoriesWithFacets, { maxChips: 40 }),
    [localCategoriesWithFacets],
  );

  const guidedHubs = useMemo(
    () => buildGuidedDiscoveryHubs(
      localCategories.flatMap((group) => group.products),
      {
        categoryConfigs,
        categoryMeta: localCategories.map((group) => ({
          category: group.category,
          displayName: group.displayName,
          imageUrl: group.imageUrl || null,
        })),
      },
    ),
    [localCategories, categoryConfigs],
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

  const intentRails = useIntentRailModel('shop', allProducts, categoryConfigs, discoveryMaxItems || 10);

  const foodListings = useMemo(
    () => allProducts.filter((product) => {
      const config = categoryConfigs.find((item) => item.category === product.category);
      return isFoodListingCategory(config?.parentGroup || product.parentGroup, product.category);
    }),
    [allProducts, categoryConfigs],
  );
  const neighborHeroUrl = useMemo(() => pickDishListingPhoto(foodListings), [foodListings]);
  const sellingWellProducts = useMemo(
    () => listingsSellingWell(allProducts),
    [allProducts],
  );

  const sellerImages = useMemo(() => {
    const images = new Map<string, { profileImage: string | null; coverImage: string | null }>();
    for (const seller of marketplaceSellers) {
      images.set(seller.seller_id, {
        profileImage: seller.profile_image_url || null,
        coverImage: seller.cover_image_url || null,
      });
    }
    return images;
  }, [marketplaceSellers]);

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

  if (marketplaceStatus === 'no-location' || marketplaceStatus === 'offline' || marketplaceStatus === 'error') {
    return (
      <div className="px-4 py-6" data-testid={`marketplace-status-${marketplaceStatus}`}>
        {marketplaceStatus === 'no-location' ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <MapPin size={18} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">Set your location to see nearby sellers</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Choose your address or allow location access, and sellers around you will show up here.
            </p>
          </div>
        ) : (
          <LoadFailureState
            variant={marketplaceStatus === 'offline' ? 'offline' : 'error'}
            title={marketplaceStatus === 'offline' ? "You're offline" : "Couldn't load the marketplace"}
            description={
              marketplaceStatus === 'offline'
                ? 'Sellers and products will load as soon as your connection is back.'
                : 'This is a connection problem, not an empty marketplace. Check your internet and try again.'
            }
            onRetry={() => { void refetchMarketplace(); }}
            retrying={marketplaceFetching}
          />
        )}
      </div>
    );
  }

  if (marketplaceStatus === 'empty') {
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
          <div id="home-featured-banners" className="scroll-mt-28">
            <FeaturedBanners />
          </div>
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
      {/* Festival hero scrolls away. The category rail stays under the header. */}
      {takeover.active && (
        <div className="pt-1" style={{ backgroundColor: takeover.bg }}>
          <FestivalHomeHero onExplore={exploreFestival} />
        </div>
      )}
      {discoveryIntents.length > 0 && (
        <div
          className="sticky top-[var(--app-header-offset,0px)] z-[34] isolate w-full border-b border-border bg-background pt-1"
        >
          <DiscoveryChipRail
            intents={discoveryIntents}
            showTitle={false}
            className="py-2.5"
          />
        </div>
      )}

      {!festivalFocused && (
        <CommerceFacetRail
          value={commerceFacets}
          onChange={setCommerceFacets}
          chips={dynamicFacetChips}
          parentGroup={activeGroup}
          className="py-1"
          inventory={facetInventory}
          showCounts={false}
        />
      )}

      {searchActive && (
        <div className="px-4 py-2" data-testid="home-search-results">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-foreground">
                {visibleSearchProducts.length} matching {visibleSearchProducts.length === 1 ? 'product' : 'products'}
              </p>
              <p className="text-xs text-muted-foreground">
                Results for {homeQuery.trim()} - use the chips above to filter
              </p>
            </div>
          </div>
          {visibleSearchProducts.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
              {visibleSearchProducts.map((product) => (
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
              <p className="text-sm font-medium text-foreground">
                {searchFetching ? 'Searching nearby products...' : 'No products match this search'}
              </p>
              {isFacetFilterActive && !searchFetching && (
                <button
                  onClick={() => setCommerceFacets(emptyCommerceFacetState())}
                  className="mt-2 text-xs text-primary font-semibold hover:underline"
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!festivalFocused && !searchActive && foodListings.length > 0 && (
        <NeighborMakesBanner
          imageUrl={neighborHeroUrl}
          onOrderNow={() => navigate('/explore/home_food')}
        />
      )}

      {!festivalFocused && !searchActive && guidedHubs.length > 0 && (
        <GuidedDiscoveryRail hubs={guidedHubs} />
      )}

      {isFacetFilterActive && !festivalFocused && !searchActive && (
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

      {!activeCategory && !festivalFocused && !searchActive && sellingWellProducts.length > 0 && (
        <div id="home-selling-well" data-testid="home-selling-well">
          <IntentProductRail
            title="Selling well nearby"
            products={sellingWellProducts}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
          />
        </div>
      )}

      {!festivalFocused && !searchActive && (
        <>
          <SectionDivider />
          <ShopByStoreDiscovery sectionTitle={ml.label('label_section_store_discovery')} />
        </>
      )}

      {!activeCategory && !festivalFocused && !searchActive && !loadingLocal && intentRails.primary && (
        <div id="home-popular-rail" data-testid="home-popular-rail" className="scroll-mt-28">
          <SectionDivider />
          <GroupedSellerRow
            title={intentRails.primary.title}
            subtitle={browsingLocation?.label || undefined}
            icon={<Flame size={15} className="text-destructive" />}
            products={intentRails.primary.products}
            sellerImages={sellerImages}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
            seeAllLink="/discovery/popular"
          />
        </div>
      )}

      {!activeCategory && !festivalFocused && !searchActive && intentRails.foodPopular && (
        <GroupedSellerRow
          title={intentRails.foodPopular.title}
          subtitle={browsingLocation?.label || undefined}
          products={intentRails.foodPopular.products}
          sellerImages={sellerImages}
          onProductTap={handleProductTap}
          categoryConfigs={categoryConfigs}
        />
      )}

      {!activeCategory && !festivalFocused && !searchActive && intentRails.recentlyViewed && (
        <IntentProductRail
          title={intentRails.recentlyViewed.title}
          products={intentRails.recentlyViewed.products}
          onProductTap={handleProductTap}
          categoryConfigs={categoryConfigs}
        />
      )}

      {!activeCategory && !festivalFocused && !searchActive && ['newlyListed', 'sinceLastVisit', 'moreInCategory', 'favourites'].map((key) => {
        const rail = intentRails[key];
        if (!rail) return null;
        return (
          <IntentProductRail
            key={key}
            title={rail.title}
            products={rail.products}
            onProductTap={handleProductTap}
            categoryConfigs={categoryConfigs}
          />
        );
      })}

      {!festivalFocused && !searchActive && (
        <LazySection>
          <div id="home-featured-banners" className="scroll-mt-28">
            <FeaturedBanners />
          </div>
        </LazySection>
      )}

      {!searchActive && (!activeCategory || festivalFocused) && festivals.length > 0 && (
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

      {!festivalFocused && showMarketplaceSkeleton && marketplaceSlow && (
        <div className="px-4 mt-2">
          <LoadFailureState
            variant="slow"
            compact
            className="mb-3"
            description="Your connection seems slow. We're still trying."
            onRetry={() => { void refetchMarketplace(); }}
          />
        </div>
      )}

      {!festivalFocused && !searchActive && (
        <LazySection>
          <div id="home-nearby-sellers" className="scroll-mt-28">
            <NearbySellersSection />
          </div>
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
