import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CalendarCheck, PackageSearch, Search, ShoppingBag, Sparkles, Users, Wrench, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { BackButton } from '@/components/navigation/BackButton';
import { ParentGroupTabs } from '@/components/home/ParentGroupTabs';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { ContactNeighborsRail, type ContactNeighbor } from '@/components/discovery/ContactNeighborsRail';
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
import { displaySellerStoreName } from '@/lib/seller-journey';
import { listingPlaceChip } from '@/lib/location-label-resolver';

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
      ? buildGuidedDiscoveryTiles('book_enquire', listings, { categoryConfigs, categoryMeta }).slice(0, 6)
      : []),
    [mode, listings, categoryConfigs, categoryMeta],
  );
  const contactTiles = useMemo(
    () => (mode === 'services'
      ? buildGuidedDiscoveryTiles('contact_seller', listings, { categoryConfigs, categoryMeta }).slice(0, 8)
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
    return [...map.values()].sort((a, b) => {
      const aLead = a[0];
      const bLead = b[0];
      const aOpen = aLead.seller_is_available !== false && aLead.seller_vacation_mode !== true ? 1 : 0;
      const bOpen = bLead.seller_is_available !== false && bLead.seller_vacation_mode !== true ? 1 : 0;
      if (bOpen !== aOpen) return bOpen - aOpen;
      const aVerified = aLead.seller_verified ? 1 : 0;
      const bVerified = bLead.seller_verified ? 1 : 0;
      if (bVerified !== aVerified) return bVerified - aVerified;
      return b.length - a.length;
    });
  }, [searched]);

  const bookListings = useMemo(() => {
    if (mode !== 'book') return searched;
    return [...searched].sort((a, b) => {
      const aOpen = a.seller_is_available !== false && a.seller_vacation_mode !== true ? 1 : 0;
      const bOpen = b.seller_is_available !== false && b.seller_vacation_mode !== true ? 1 : 0;
      if (bOpen !== aOpen) return bOpen - aOpen;
      const aVerified = a.seller_verified ? 1 : 0;
      const bVerified = b.seller_verified ? 1 : 0;
      if (bVerified !== aVerified) return bVerified - aVerified;
      const aDur = Number(a.service_duration_minutes) || Number.POSITIVE_INFINITY;
      const bDur = Number(b.service_duration_minutes) || Number.POSITIVE_INFINITY;
      return aDur - bDur;
    });
  }, [mode, searched]);

  const faceRailNeighbors = useMemo<ContactNeighbor[]>(() => {
    if ((mode !== 'services' && mode !== 'book') || searchActive || activeCategory) return [];
    return sellerGroups.slice(0, 12).map((group) => {
      const lead = group[0];
      const photo = String(
        lead.seller_profile_image_url
        || (lead as any).seller_cover_image_url
        || (lead as any).seller?.cover_image_url
        || group.find((item) => item.image_url)?.image_url
        || '',
      ).trim() || null;
      return {
        sellerId: lead.seller_id || lead.id,
        name: displaySellerStoreName(lead.seller_name) || 'Neighbor',
        imageUrl: photo,
        open: lead.seller_is_available !== false && lead.seller_vacation_mode !== true,
        listingCount: group.length,
      };
    });
  }, [mode, searchActive, activeCategory, sellerGroups]);

  const discoveryTiles = mode === 'book' ? bookTiles : contactTiles;
  const searchHints = useMemo(() => {
    if (mode !== 'services' && mode !== 'book') return [];
    return discoveryTiles
      .map((tile) => ({
        id: tile.id,
        label: tile.label.split(/[·|/]/)[0]?.trim() || tile.label,
        kind: 'category' as const,
        value: tile.id.startsWith('category:') ? tile.id.slice('category:'.length) : null,
      }))
      .filter((hint) => hint.value)
      .slice(0, 6);
  }, [mode, discoveryTiles]);

  const placeLabel = listingPlaceChip(browsingLocation?.label) || browsingLocation?.label || null;

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

  const selectContactTile = useCallback((id: string) => {
    hapticSelection();
    const slug = id.startsWith('category:') ? id.slice('category:'.length) : id;
    selectCategory(activeCategory === slug ? null : slug);
  }, [activeCategory, selectCategory]);

  const jumpToNeighbor = useCallback((sellerId: string) => {
    if (mode === 'book') {
      const first = bookListings.find((product) => (product.seller_id || product.id) === sellerId);
      const node = first
        ? document.getElementById(`book-listing-${first.id}`)
        : null;
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    document.getElementById(`contact-seller-${sellerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [mode, bookListings]);

  const applySearchHint = useCallback((hint: { label: string; value: string | null }) => {
    hapticSelection();
    if (hint.value) {
      selectCategory(activeCategory === hint.value ? null : hint.value);
      return;
    }
    setQuery(hint.label);
    setSearchOpen(false);
  }, [activeCategory, selectCategory]);

  const resetFilters = useCallback(() => {
    selectCategory(null);
  }, [selectCategory]);

  const hasListings = enriched.length > 0;

  return (
    <AppLayout showHeader={!mockupChrome} safeTop={mockupChrome ? false : undefined}>
      <div
        data-testid={`commerce-mode-${mode}`}
        data-mode={mode}
        className={cn(
          'pb-4',
          mode === 'services' && 'contact-seller-page',
          mode === 'book' && 'book-enquire-page',
        )}
      >
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
            {mode === 'services' && hasListings && !searchActive && (
              <div className="contact-seller-hero mx-4 mt-2 overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-emerald-950 via-zinc-900 to-zinc-800 px-4 py-4 text-white shadow-[0_22px_48px_-24px_rgba(6,78,59,0.95)]">
                <div className="relative z-10">
                  <p className="text-[10px] font-extrabold tracking-[0.2em] text-emerald-200/90">NEIGHBORS NEARBY</p>
                  <p className="mt-1.5 max-w-[18rem] text-[19px] font-extrabold leading-[1.15] tracking-tight">
                    Message local makers, cabs, and repair pros directly.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                      {sellerGroups.length > 0
                        ? `${sellerGroups.length} neighbor${sellerGroups.length === 1 ? '' : 's'}`
                        : 'Neighbors nearby'}
                    </span>
                    {placeLabel && (
                      <span className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-bold text-emerald-100 ring-1 ring-emerald-300/20">
                        {placeLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {mode === 'book' && hasListings && !searchActive && (
              <div className="book-enquire-hero mx-4 mt-2 overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-teal-950 via-zinc-900 to-zinc-800 px-4 py-4 text-white shadow-[0_22px_48px_-24px_rgba(19,78,74,0.95)]">
                <div className="relative z-10">
                  <p className="text-[10px] font-extrabold tracking-[0.2em] text-[#7dd3c7]">BOOK NEARBY</p>
                  <p className="mt-1.5 max-w-[18rem] text-[19px] font-extrabold leading-[1.15] tracking-tight">
                    <span className="block">Salon, tuition, fitness,</span>
                    <span className="book-hero-punch">reserve a slot with neighbors.</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                      {bookListings.length > 0
                        ? `${bookListings.length} service${bookListings.length === 1 ? '' : 's'}`
                        : 'Services nearby'}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                      {sellerGroups.length > 0
                        ? `${sellerGroups.length} pro${sellerGroups.length === 1 ? '' : 's'}`
                        : 'Pros nearby'}
                    </span>
                    {placeLabel && (
                      <span className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-bold text-emerald-100 ring-1 ring-emerald-300/20">
                        {placeLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
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
                    placeholder={mode === 'book' ? 'Try haircut, yoga, tuition...' : 'Try saree, cab, repair...'}
                    data-testid="commerce-mode-search"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    inputMode="search"
                    className={cn(
                      'h-11 w-full rounded-2xl border border-border bg-muted/50 pl-10 pr-9 text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40',
                      (mode === 'services' || mode === 'book')
                        && 'h-12 rounded-[18px] border-primary/20 bg-card shadow-[0_14px_34px_-18px_rgba(15,23,42,0.4)] focus:shadow-[0_16px_36px_-16px_hsl(var(--primary)/0.35)]',
                    )}
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
                {(mode === 'services' || mode === 'book') && !searchActive && searchHints.length > 0 && (
                  <div
                    className="mt-2.5 flex gap-2 overflow-x-auto scrollbar-hide pb-0.5"
                    data-testid={mode === 'book' ? 'book-search-hints' : 'contact-search-hints'}
                  >
                    {searchHints.map((hint) => {
                      const selected = hint.value != null && activeCategory === hint.value;
                      return (
                        <button
                          key={hint.id}
                          type="button"
                          onClick={() => applySearchHint(hint)}
                          className={cn(
                            'shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-all active:scale-[0.98]',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground shadow-[0_8px_18px_-8px_hsl(var(--primary)/0.8)]'
                              : 'border-border/80 bg-card/90 text-foreground shadow-[0_8px_20px_-14px_rgba(15,23,42,0.35)] backdrop-blur-sm',
                          )}
                        >
                          {hint.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {mode === 'book' && !searchActive && <div className="px-4 mt-2.5"><UpcomingAppointmentBanner /></div>}
            {hasListings && mode === 'book' && !searchActive && bookTiles.length > 0 && (
              <div className="px-4 mt-3.5" data-testid="book-browse-service">
                <div className="mb-3 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary">
                      <Sparkles size={14} />
                      POPULAR SERVICES
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      Tap a world to narrow what you can book
                    </p>
                  </div>
                  {activeCategory && (
                    <button
                      type="button"
                      onClick={() => selectCategory(null)}
                      className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-primary shadow-sm"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3" data-testid="guided-discovery-tiles">
                  {bookTiles.map((tile) => (
                    <GuidedDiscoveryOverlayTile
                      key={tile.id}
                      tile={{
                        ...tile,
                        subtitle: tile.count > 0
                          ? `${tile.count} nearby · ${tile.subtitle || 'Book a time'}`
                          : tile.subtitle,
                      }}
                      selected={activeCategory === tile.id.slice('category:'.length)}
                      service
                      cinematic
                      onSelect={selectBookTile}
                    />
                  ))}
                </div>
              </div>
            )}
            {hasListings && mode === 'services' && !searchActive && contactTiles.length > 0 && (
              <div className="mt-3" data-testid="contact-browse-need">
                <div className="mb-2.5 px-4">
                  <p className="text-[17px] font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Browse by need
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    Pick a category to narrow who you message
                  </p>
                </div>
                <div className="discovery-chip-scroll scrollbar-hide">
                  <div className="flex w-max items-stretch gap-3 px-4 pr-6 pb-1">
                    {contactTiles.map((tile) => (
                      <GuidedDiscoveryOverlayTile
                        key={tile.id}
                        tile={{
                          ...tile,
                          eta: tile.count > 0
                            ? `${tile.count} listing${tile.count === 1 ? '' : 's'}`
                            : tile.eta,
                        }}
                        selected={activeCategory === tile.id.slice('category:'.length)}
                        compact
                        showEta
                        onSelect={selectContactTile}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {mode === 'services' && !searchActive && faceRailNeighbors.length > 0 && (
              <ContactNeighborsRail
                neighbors={faceRailNeighbors}
                onSelect={jumpToNeighbor}
                className="mt-2"
              />
            )}
            {mode === 'book' && !searchActive && faceRailNeighbors.length > 0 && (
              <ContactNeighborsRail
                neighbors={faceRailNeighbors}
                onSelect={jumpToNeighbor}
                className="mt-2"
                title="Pros to book"
                subtitle="Tap a face to jump to their services"
                testId="book-providers-rail"
              />
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
                    {mode === 'services'
                      ? `${sellerGroups.length} neighbor${sellerGroups.length === 1 ? '' : 's'} · ${searched.length} listing${searched.length === 1 ? '' : 's'}`
                      : mode === 'book'
                        ? `${bookListings.length} service${bookListings.length === 1 ? '' : 's'} · ${sellerGroups.length} pro${sellerGroups.length === 1 ? '' : 's'}`
                        : `${searched.length} matching ${searched.length === 1 ? 'listing' : 'listings'}`}
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
                  <div className="min-w-0">
                    <p className={cn(
                      (mode === 'services' || mode === 'book')
                        ? 'flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary'
                        : 'text-[15px] font-extrabold tracking-tight text-foreground',
                    )}>
                      {mode === 'services' && <Users size={14} />}
                      {mode === 'book' && <CalendarCheck size={14} />}
                      {mode === 'services' ? 'Browse neighbors' : mode === 'book' ? 'Book a slot' : 'Popular services'}
                    </p>
                    {(mode === 'services' || mode === 'book') && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {mode === 'services'
                          ? `${sellerGroups.length} neighbor${sellerGroups.length === 1 ? '' : 's'}`
                          : `${bookListings.length} service${bookListings.length === 1 ? '' : 's'}`}
                        {activeCategory
                          ? ` in ${categoryMeta.find((meta) => meta.category === activeCategory)?.displayName || activeCategory}`
                          : ''}
                      </p>
                    )}
                  </div>
                  {(mode === 'services' || mode === 'book') && activeCategory && (
                    <button
                      type="button"
                      onClick={() => selectCategory(null)}
                      className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-primary"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
              {isLoading ? (
                <div data-testid="commerce-mode-loading">
                  <ProductCardSkeleton count={9} />
                </div>
              ) : mode === 'book' && bookListings.length > 0 ? (
                <div className="space-y-3">
                  {bookListings.map((product, index) => (
                    <div
                      key={product.id}
                      className="book-listing-card-enter"
                      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                    >
                      <GuidedDiscoveryProductRow
                        product={product}
                        onTap={handleProductTap}
                        categoryConfigs={categoryConfigs}
                      />
                    </div>
                  ))}
                </div>
              ) : mode === 'services' && sellerGroups.length > 0 ? (
                <div className="space-y-3.5">
                  {sellerGroups.map((group, index) => (
                    <div
                      key={group[0].seller_id || group[0].id}
                      className="contact-seller-card-enter"
                      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                    >
                      <GuidedDiscoverySellerCard
                        products={group}
                        categoryLabel={categoryMeta.find((meta) => meta.category === group[0].category)?.displayName || group[0].category}
                        categoryConfigs={categoryConfigs}
                        onOpenListing={handleProductTap}
                      />
                    </div>
                  ))}
                </div>
              ) : mode === 'shop' && catalogGrid.length > 0 ? (
                <div className={cn(
                  'grid gap-2 sm:gap-3',
                  'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
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
