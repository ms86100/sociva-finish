import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CalendarCheck, PackageSearch, Search, ShoppingBag, Sparkles, Users, Wrench, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { BackButton } from '@/components/navigation/BackButton';
import { ParentGroupTabs } from '@/components/home/ParentGroupTabs';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { GuidedDiscoveryOverlayTile } from '@/components/discovery/GuidedDiscoveryOverlayTile';
import { GuidedDiscoveryProductRow } from '@/components/discovery/GuidedDiscoveryProductRow';
import { GuidedDiscoverySellerCard } from '@/components/discovery/GuidedDiscoverySellerCard';
import { ProductListingCard, type ProductWithSeller } from '@/components/product/ProductListingCard';
import { ProductCardSkeleton } from '@/components/product/ProductCardSkeleton';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { Button } from '@/components/ui/button';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useCommerceModeListings } from '@/hooks/queries/useCommerceModeListings';
import { applyProductFacetRow, useProductFacets } from '@/hooks/queries/useProductFacets';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';
import type { CommerceMode } from '@/lib/commerce-mode';
import { categoriesListedInMode, filterByMode } from '@/lib/commerce-mode';
import { listingMatchesCategoryChip } from '@/lib/food-facets';
import {
  type CommerceFacetState,
  emptyCommerceFacetState,
  extractAvailableCommerceFacets,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
  purposeChipsForMode,
} from '@/lib/commerce-facets';
import { buildProductDetailPayload, buildRelatedProductDetailPayload } from '@/lib/product-detail-payload';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import {
  buildGuidedDiscoveryTiles,
  type GuidedDiscoveryCategoryMeta,
} from '@/lib/guided-discovery';
import { IntentProductRail } from '@/components/discovery/IntentProductRail';
import { UpcomingAppointmentBanner } from '@/components/home/UpcomingAppointmentBanner';
import { GroupedSellerRow } from '@/components/home/GroupedSellerRow';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { useIntentRailModel } from '@/hooks/useIntentRailModel';
import { listingIdsFromCardRails, listingsForCatalogGrid } from '@/lib/intent-rails';
import { useNearbyProductSearch } from '@/hooks/queries/useNearbyProductSearch';
import { listingMatchesSearchText, stampSellerHoursFromInventory } from '@/lib/listing-search';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

export const COMMERCE_MODE_COPY: Record<CommerceMode, {
  title: string;
  subtitle: string;
  empty: string;
  emptyHint: string;
}> = {
  shop: {
    title: 'Shop',
    subtitle: 'Add to cart from sellers near you',
    empty: 'Nothing to shop nearby yet',
    emptyHint: 'Sellers near you have not listed items for delivery or pickup yet.',
  },
  book: {
    title: 'Book and Enquire',
    subtitle: 'Tuition, salon, fitness and more',
    empty: 'Nothing to book nearby yet',
    emptyHint: 'No classes, sessions or appointments are open for booking near you yet.',
  },
  services: {
    title: 'Contact Seller',
    subtitle: 'Browse neighbors and message them directly.',
    empty: 'No one nearby is taking enquiries yet',
    emptyHint: 'Sellers near you have not listed anything to enquire about yet.',
  },
};

const MODE_ACCENT: Record<CommerceMode, { chip: string; icon: typeof ShoppingBag }> = {
  shop: { chip: 'bg-mode-shop text-mode-shop-foreground', icon: ShoppingBag },
  book: { chip: 'bg-mode-book text-mode-book-foreground', icon: CalendarCheck },
  services: { chip: 'bg-mode-services text-mode-services-foreground', icon: Wrench },
};

export function commerceModeFromPath(pathname: string): CommerceMode {
  if (pathname.startsWith('/book')) return 'book';
  if (pathname.startsWith('/services') || pathname.startsWith('/contact')) return 'services';
  return 'shop';
}

export default function CommerceModePage() {
  const mode = commerceModeFromPath(useLocation().pathname);
  return <CommerceModeView key={mode} mode={mode} />;
}

function CommerceModeView({ mode }: { mode: CommerceMode }) {
  const navigate = useNavigate();
  const copy = COMMERCE_MODE_COPY[mode];
  const accent = MODE_ACCENT[mode];
  const ModeIcon = accent.icon;

  const { browsingLocation } = useBrowsingLocation();
  const needsPreciseLocation = !hasPreciseCoordinates(browsingLocation?.lat, browsingLocation?.lng);

  const { listings, buckets, categoryConfigs, isLoading, topUpError, retryTopUp } = useCommerceModeListings(mode);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<string | null>(searchParams.get('sub'));
  const [facets, setFacets] = useState<CommerceFacetState>(emptyCommerceFacetState());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const listingIds = useMemo(() => listings.map((p) => p.id), [listings]);
  const { data: facetRows = {} } = useProductFacets(listingIds, listingIds.length > 0);
  const enriched = useMemo(
    () => listings.map((p) => applyProductFacetRow(
      { ...p, parentGroup: categoryConfigs.find((c) => c.category === p.category)?.parentGroup || p.category },
      facetRows[p.id],
    )),
    [listings, facetRows, categoryConfigs],
  );

  const modeCategories = useMemo(
    () => categoriesListedInMode(buckets, mode),
    [buckets, mode],
  );
  const activeGroup = activeCategory
    ? categoryConfigs.find((c) => c.category === activeCategory)?.parentGroup ?? null
    : null;

  const scoped = useMemo(
    () => (activeCategory ? enriched.filter((p) => listingMatchesCategoryChip(p, activeCategory)) : enriched),
    [enriched, activeCategory],
  );

  const queryNorm = query.trim().toLowerCase();
  const searchActive = queryNorm.length >= 2;
  const { data: ftsListings = [], isFetching: searchFetching } = useNearbyProductSearch(query);

  const textMatched = useMemo(() => {
    if (!searchActive) return scoped;
    const localHits = enriched.filter((product) => listingMatchesSearchText(product, queryNorm));
    const byId = new Map(localHits.map((product) => [product.id, product]));
    for (const row of filterByMode(ftsListings, mode, categoryConfigs)) {
      if (byId.has(row.id)) continue;
      const local = enriched.find((product) => product.id === row.id);
      byId.set(row.id, stampSellerHoursFromInventory(local || applyProductFacetRow(row, facetRows[row.id]), enriched));
    }
    return [...byId.values()];
  }, [searchActive, queryNorm, scoped, enriched, ftsListings, mode, categoryConfigs, facetRows]);

  const facetInventory = searchActive ? textMatched : scoped;

  const facetChips = useMemo(() => {
    const chips = extractAvailableCommerceFacets(facetInventory, { parentGroup: activeGroup, currentState: facets, categoryConfigs });
    return purposeChipsForMode(mode, chips, facetInventory, {
      categoryConfigs,
      actionType: facets.actionType,
    });
  }, [facetInventory, activeGroup, facets, categoryConfigs, mode]);

  const visible = useMemo(
    () => (hasActiveCommerceFacets(facets)
      ? scoped.filter((p) => productMatchesCommerceFacets(p, facets, categoryConfigs))
      : scoped),
    [scoped, facets, categoryConfigs],
  );
  const searched = useMemo(() => {
    if (!searchActive) return visible;
    if (!hasActiveCommerceFacets(facets)) return textMatched;
    return textMatched.filter((product) => productMatchesCommerceFacets(product, facets, categoryConfigs));
  }, [searchActive, visible, textMatched, facets, categoryConfigs]);
  const intentRails = useIntentRailModel(mode, enriched, categoryConfigs);
  const catalogGrid = useMemo(
    () => listingsForCatalogGrid(visible, listingIdsFromCardRails(intentRails), Boolean(activeCategory)),
    [visible, intentRails, activeCategory],
  );
  const mockupChrome = mode === 'book' || mode === 'services';
  const categoryMeta = useMemo<GuidedDiscoveryCategoryMeta[]>(
    () => categoryConfigs.map((config) => ({
      category: config.category,
      displayName: (config as { displayName?: string }).displayName,
      imageUrl: (config as { imageUrl?: string | null }).imageUrl || null,
    })),
    [categoryConfigs],
  );
  const bookTiles = useMemo(
    () => (mode === 'book'
      ? buildGuidedDiscoveryTiles('book_enquire', listings, { categoryConfigs, categoryMeta }).slice(0, 4)
      : []),
    [mode, listings, categoryConfigs, categoryMeta],
  );
  const sellerGroups = useMemo(() => {
    const map = new Map<string, ProductWithSeller[]>();
    for (const product of searched) {
      const key = product.seller_id || product.id;
      const list = map.get(key) || [];
      list.push(product);
      map.set(key, list);
    }
    return [...map.values()];
  }, [searched]);

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    setSelectedProduct(buildProductDetailPayload(product, categoryConfigs));
    setDetailOpen(true);
  }, [categoryConfigs]);

  const selectCategory = useCallback((cat: string | null) => {
    setActiveCategory(cat);
    setFacets(emptyCommerceFacetState());
    setQuery('');
    const next = new URLSearchParams(searchParams);
    if (cat) next.set('sub', cat);
    else next.delete('sub');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectBookTile = useCallback((id: string) => {
    hapticSelection();
    const slug = id.startsWith('category:') ? id.slice('category:'.length) : id;
    selectCategory(activeCategory === slug ? null : slug);
  }, [activeCategory, selectCategory]);

  const resetFilters = useCallback(() => {
    selectCategory(null);
  }, [selectCategory]);

  const hasListings = enriched.length > 0;

  return (
    <AppLayout showHeader={!mockupChrome} safeTop={mockupChrome ? false : undefined}>
      <div data-testid={`commerce-mode-${mode}`} data-mode={mode} className="pb-4">
        {mockupChrome ? (
          <SafeHeader bordered={false} blur>
            <div className="px-4 pt-1 pb-2">
              {mode === 'book' ? (
                <div className="flex items-center gap-1 min-h-11">
                  <BackButton fallback="/" className="bg-transparent text-primary w-9 h-9" />
                  <div className="min-w-0">
                    <h1 className="text-[18px] font-extrabold truncate leading-tight">{copy.title}</h1>
                    <p className="text-[11px] text-muted-foreground truncate">{copy.subtitle}</p>
                  </div>
                </div>
              ) : (
                <div className="relative flex items-center min-h-11">
                  <BackButton fallback="/" className="absolute left-0 bg-transparent text-primary w-9 h-9" />
                  <div className="mx-12 min-w-0 flex-1 text-center">
                    <h1 className="text-[17px] font-extrabold truncate text-primary">{copy.title}</h1>
                    <p className="text-[11px] text-muted-foreground truncate">{copy.subtitle}</p>
                  </div>
                </div>
              )}
            </div>
          </SafeHeader>
        ) : (
          <div className="px-4 pt-3 pb-2 flex items-center gap-3">
            <span className={cn('w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', accent.chip)}>
              <ModeIcon size={20} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-display-sm text-foreground truncate">{copy.title}</h1>
              <p className="text-xs text-muted-foreground truncate">{copy.subtitle}</p>
            </div>
          </div>
        )}
        {!isLoading && hasListings && (
          <span className="sr-only" data-testid="commerce-mode-count">
            {enriched.length} listing{enriched.length !== 1 ? 's' : ''}
          </span>
        )}

        {needsPreciseLocation ? (
          <PreciseLocationRequiredCard />
        ) : (
          <>
            {hasListings && mode === 'shop' && (
              <ParentGroupTabs
                activeCategory={activeCategory}
                onCategoryChange={selectCategory}
                activeCategories={modeCategories}
              />
            )}
            {hasListings && mockupChrome && (
              <div className="relative z-20 px-4 mt-2">
                <label className="relative block">
                  <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={(event) => {
                      const host = event.currentTarget.closest('label') || event.currentTarget.parentElement;
                      window.setTimeout(() => {
                        if (host?.contains(document.activeElement)) return;
                        setSearchOpen(false);
                      }, 80);
                    }}
                    placeholder={mode === 'book' ? 'Haircut, yoga, tuition' : 'Saree, cab, repair'}
                    data-testid="commerce-mode-search"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    inputMode="search"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/50 pl-10 pr-9 text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <SearchAutocomplete
                    query={query}
                    inputRef={searchInputRef}
                    open={searchOpen}
                    maxHeight={220}
                    onDismiss={() => {
                      setSearchOpen(false);
                      searchInputRef.current?.blur();
                    }}
                    onSelect={(product) => {
                      setSearchOpen(false);
                      searchInputRef.current?.blur();
                      setSelectedProduct(product);
                      setDetailOpen(true);
                    }}
                  />
                </label>
              </div>
            )}
            {mode === 'book' && !searchActive && <div className="px-4 mt-2"><UpcomingAppointmentBanner /></div>}
            {hasListings && mode === 'book' && !searchActive && bookTiles.length > 0 && (
              <div className="px-4 mt-2">
                <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary">
                  <Sparkles size={14} />
                  POPULAR SERVICES
                </p>
                <div className="grid grid-cols-2 gap-3" data-testid="guided-discovery-tiles">
                  {bookTiles.map((tile) => (
                    <GuidedDiscoveryOverlayTile
                      key={tile.id}
                      tile={tile}
                      selected={activeCategory === tile.id.slice('category:'.length)}
                      service
                      onSelect={selectBookTile}
                    />
                  ))}
                </div>
              </div>
            )}
            {hasListings && (
              <CommerceFacetRail
                value={facets}
                onChange={setFacets}
                chips={facetChips}
                parentGroup={activeGroup}
                className="py-1"
                inventory={facetInventory}
              />
            )}
            {!activeCategory && mode === 'shop' && intentRails.primary && (
              <GroupedSellerRow
                title={intentRails.primary.title}
                subtitle={browsingLocation?.label || undefined}
                icon={<ShoppingBag size={15} className="text-primary" />}
                products={intentRails.primary.products}
                onProductTap={handleProductTap}
                categoryConfigs={categoryConfigs}
              />
            )}
            {!activeCategory && mode === 'shop' && ['recentlyViewed', 'newlyListed', 'sinceLastVisit', 'moreInCategory', 'favourites'].map((key) => {
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

            {topUpError && (
              <div
                role="alert"
                data-testid="commerce-mode-error"
                className="mx-4 mt-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2.5"
              >
                <AlertCircle size={16} className="text-destructive shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Some listings could not load</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Check your connection and try again.</p>
                </div>
                <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={() => void retryTopUp()}>
                  Retry
                </Button>
              </div>
            )}

            <div className={cn(mockupChrome ? 'px-4 mt-4' : 'px-3 sm:px-4 pt-2')} data-testid={searchActive ? 'commerce-mode-search-results' : undefined}>
              {searchActive && !isLoading && (
                <div className="mb-3">
                  <p className="text-sm font-bold text-foreground">
                    {searched.length} matching {searched.length === 1 ? 'listing' : 'listings'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchFetching && searched.length === 0
                      ? 'Searching nearby listings...'
                      : `Results for ${query.trim()} - use the chips above to filter`}
                  </p>
                </div>
              )}
              {!isLoading && searched.length > 0 && mockupChrome && !searchActive && (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className={cn(
                    mode === 'services'
                      ? 'flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary'
                      : 'text-[15px] font-extrabold tracking-tight text-foreground',
                  )}>
                    {mode === 'services' && <Users size={14} />}
                    {mode === 'services' ? 'Browse listings' : 'Popular services'}
                  </p>
                </div>
              )}
              {isLoading ? (
                <div data-testid="commerce-mode-loading">
                  <ProductCardSkeleton count={9} />
                </div>
              ) : mode === 'book' && searched.length > 0 ? (
                <div className="space-y-2.5">
                  {searched.map((product) => (
                    <GuidedDiscoveryProductRow
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      categoryConfigs={categoryConfigs}
                    />
                  ))}
                </div>
              ) : mode === 'services' && sellerGroups.length > 0 ? (
                <div className="space-y-3">
                  {sellerGroups.map((group) => (
                    <GuidedDiscoverySellerCard
                      key={group[0].seller_id || group[0].id}
                      products={group}
                      categoryLabel={categoryMeta.find((meta) => meta.category === group[0].category)?.displayName || group[0].category}
                      categoryConfigs={categoryConfigs}
                      onOpenListing={handleProductTap}
                    />
                  ))}
                </div>
              ) : mode === 'shop' && catalogGrid.length > 0 ? (
                <div className={cn(
                  'grid gap-2 sm:gap-3',
                  'grid-cols-3 sm:grid-cols-3 md:grid-cols-4',
                )} data-testid="commerce-mode-grid">
                  {catalogGrid.map((product) => (
                    <ProductListingCard
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      onNavigate={navigate}
                      categoryConfigs={categoryConfigs}
                    />
                  ))}
                </div>
              ) : hasListings && visible.length === 0 ? (
                <div className="p-6 rounded-2xl bg-muted/40 text-center border border-dashed border-border">
                  <p className="text-sm font-medium text-foreground">No listings match these filters</p>
                  <button onClick={resetFilters} className="mt-2 text-xs text-primary font-semibold hover:underline">
                    Reset filters
                  </button>
                </div>
              ) : hasListings && searched.length === 0 ? (
                <div className="p-6 rounded-2xl bg-muted/40 text-center border border-dashed border-border">
                  <p className="text-sm font-medium text-foreground">No listings match this search</p>
                  <button onClick={() => setQuery('')} className="mt-2 text-xs text-primary font-semibold hover:underline">
                    Show all listings
                  </button>
                </div>
              ) : hasListings ? null : !topUpError ? (
                <div className="py-14 px-4 text-center flex flex-col items-center" data-testid="commerce-mode-empty">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <PackageSearch size={28} className="text-muted-foreground" aria-hidden />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{copy.empty}</p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-[260px] leading-relaxed">{copy.emptyHint}</p>
                  <Button size="sm" variant="outline" className="mt-4 h-9 text-xs" onClick={() => navigate('/search')}>
                    Search Sociva
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

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
    </AppLayout>
  );
}
