import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Sparkles, Users } from 'lucide-react';
import { GuidedRoomHero } from '@/components/discovery/GuidedRoomHero';
import { CookingNearbyRail } from '@/components/home/CookingNearbyRail';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { BackButton } from '@/components/navigation/BackButton';
import { type ProductWithSeller } from '@/components/product/ProductListingCard';
import { GuidedDiscoveryOverlayTile } from '@/components/discovery/GuidedDiscoveryOverlayTile';
import { GuidedDiscoveryProductRow } from '@/components/discovery/GuidedDiscoveryProductRow';
import { GuidedDiscoverySellerCard } from '@/components/discovery/GuidedDiscoverySellerCard';
import { GuidedRoomSwipeRail } from '@/components/discovery/GuidedRoomSwipeRail';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { applyProductFacetRow, useProductFacets } from '@/hooks/queries/useProductFacets';
import { buildProductDetailPayload, buildRelatedProductDetailPayload } from '@/lib/product-detail-payload';
import { hapticSelection } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import {
  buildGuidedCuisineChips,
  buildGuidedDiscoveryHubs,
  buildGuidedDiscoveryTiles,
  buildGuidedListingSnapshot,
  filterGuidedDiscoveryListings,
  GUIDED_DISCOVERY_AISLE_HEADING,
  GUIDED_DISCOVERY_SHELF_HEADING,
  guidedDiscoveryPageSubtitle,
  guidedDiscoveryPageTitle,
  guidedDiscoverySeeAllHref,
  guidedListingHeadline,
  guidedListingSubline,
  isGuidedDiscoveryHubId,
  listingsForGuidedHub,
  type GuidedDiscoveryCategoryMeta,
} from '@/lib/guided-discovery';
import { useCurrency } from '@/hooks/useCurrency';
import {
  buildGuidedRoomRails,
  ROOM_BESTSELLERS_HEADING,
  ROOM_READY_HEADING,
  ROOM_VALUE_HEADING,
  roomContinueHref,
  roomContinueLabel,
} from '@/lib/guided-room-rails';
import { buildCookingNearbyKitchens } from '@/lib/cooking-nearby';
import { parseCuisineParam, type FoodCuisineId } from '@/lib/food-facets';
import { pickDishListingPhoto } from '@/lib/chip-listing-photo';
import { HOME_FOOD_HERO_ART, RESTAURANT_FOOD_HERO_ART } from '@/lib/food-chip-art';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

const OVERVIEW_PRODUCT_CAP = 8;
const FOOD_SHELF_CAP = 12;
const OVERVIEW_SELLER_CAP = 6;

export default function GuidedDiscoveryHubPage() {
  const { hubId: rawHubId } = useParams<{ hubId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tileId = searchParams.get('tile');
  const cuisine = parseCuisineParam(searchParams.get('cuisine'));
  const { formatPrice } = useCurrency();

  const { configs: categoryConfigs, isLoading: configsLoading } = useCategoryConfigs();
  const {
    data: groups = [],
    isLoading: listingsLoading,
  } = useProductsByCategory(80);

  const [selectedProduct, setSelectedProduct] = useState<ReturnType<typeof buildProductDetailPayload> | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const allListings = useMemo(
    () => groups.flatMap((group) => group.products),
    [groups],
  );
  const hubDefId = isGuidedDiscoveryHubId(rawHubId) ? rawHubId : null;
  const listingIds = useMemo(
    () => (hubDefId
      ? listingsForGuidedHub(hubDefId, allListings, categoryConfigs).map((listing) => listing.id)
      : allListings.map((listing) => listing.id)),
    [hubDefId, allListings, categoryConfigs],
  );
  const { data: facetRows = {} } = useProductFacets(listingIds, listingIds.length > 0);
  const listings = useMemo(
    () => allListings.map((listing) => applyProductFacetRow(listing, facetRows[listing.id])),
    [allListings, facetRows],
  );

  const categoryMeta = useMemo<GuidedDiscoveryCategoryMeta[]>(
    () => groups.map((group) => ({
      category: group.category,
      displayName: group.displayName,
      imageUrl: group.imageUrl || null,
    })),
    [groups],
  );

  const hubs = useMemo(
    () => buildGuidedDiscoveryHubs(listings, { categoryConfigs, categoryMeta }),
    [listings, categoryConfigs, categoryMeta],
  );

  const hub = isGuidedDiscoveryHubId(rawHubId)
    ? hubs.find((item) => item.id === rawHubId) || null
    : null;

  const tiles = useMemo(
    () => (hubDefId
      ? buildGuidedDiscoveryTiles(hubDefId, listings, { categoryConfigs, categoryMeta })
      : []),
    [hubDefId, listings, categoryConfigs, categoryMeta],
  );

  const visibleListings = useMemo(
    () => (hubDefId
      ? filterGuidedDiscoveryListings(hubDefId, listings, { tileId, cuisine, categoryConfigs })
      : []),
    [hubDefId, listings, tileId, cuisine, categoryConfigs],
  );

  const cuisineChips = useMemo(
    () => buildGuidedCuisineChips(
      hubDefId
        ? filterGuidedDiscoveryListings(hubDefId, listings, { tileId, categoryConfigs })
        : [],
    ),
    [hubDefId, listings, tileId, categoryConfigs],
  );

  const sellerGroups = useMemo(() => {
    const map = new Map<string, ProductWithSeller[]>();
    for (const product of visibleListings) {
      const list = map.get(product.seller_id) || [];
      list.push(product);
      map.set(product.seller_id, list);
    }
    return [...map.values()];
  }, [visibleListings]);

  const activeTile = tiles.find((tile) => tile.id === tileId) || null;
  const loading = configsLoading || listingsLoading;
  const listingMode = Boolean(activeTile);
  const foodHub = hubDefId === 'home_food' || hubDefId === 'restaurant_food';
  const contactHub = hubDefId === 'contact_seller';
  const bookHub = hubDefId === 'book_enquire';
  const shopRoom = !listingMode && hub?.kind === 'shop_categories';
  const compactAisleStrip = shopRoom && foodHub && tiles.length > 0;
  const overlayTiles = bookHub ? tiles.slice(0, 4) : tiles;
  const overlayGrid = !listingMode && !compactAisleStrip && !contactHub && overlayTiles.length > 0;
  const shopGrid = !listingMode && !contactHub && !bookHub && hubDefId !== 'services';
  const roomHero = shopRoom && foodHub;
  const showHero = !listingMode && !roomHero && !!hub?.imageUrl && hub.kind === 'shop_categories';
  // Shared Room banner art - Home Food cooking scene, Restaurant Food plated food
  const dishHeroUrl = roomHero
    ? (
      (hubDefId === 'home_food' ? HOME_FOOD_HERO_ART : RESTAURANT_FOOD_HERO_ART)
      || pickDishListingPhoto(visibleListings)
      || hub?.imageUrl
      || null
    )
    : null;
  const aisleHeading = hubDefId === 'home_food'
    ? GUIDED_DISCOVERY_AISLE_HEADING
    : hubDefId === 'restaurant_food'
      ? 'Browse by cuisine'
      : 'Browse aisles';
  const shelfHeading = shopRoom ? GUIDED_DISCOVERY_SHELF_HEADING : null;
  const foodRoomOverview = shopRoom && foodHub && !listingMode;
  const overviewListings = listingMode
    ? visibleListings
    : visibleListings.slice(0, foodRoomOverview ? FOOD_SHELF_CAP : OVERVIEW_PRODUCT_CAP);
  const overviewSellers = listingMode ? sellerGroups : sellerGroups.slice(0, OVERVIEW_SELLER_CAP);

  const listingSnapshot = useMemo(
    () => (listingMode ? buildGuidedListingSnapshot(visibleListings) : null),
    [listingMode, visibleListings],
  );
  const overviewSnapshot = useMemo(
    () => (foodRoomOverview ? buildGuidedListingSnapshot(visibleListings) : null),
    [foodRoomOverview, visibleListings],
  );
  const cuisineLabel = cuisine
    ? (cuisineChips.find((chip) => chip.id === cuisine)?.label || null)
    : null;
  const listingSubline = listingSnapshot
    ? guidedListingSubline(listingSnapshot, { cuisineLabel })
    : null;
  const listingHeroUrl = listingSnapshot?.heroImageUrl
    || activeTile?.imageUrl
    || null;

  const roomKitchens = useMemo(
    () => (foodRoomOverview
      ? buildCookingNearbyKitchens(visibleListings as any, {
        limit: 10,
        categoryConfigs,
      })
      : []),
    [foodRoomOverview, visibleListings, categoryConfigs],
  );

  const roomRails = useMemo(
    () => (foodRoomOverview ? buildGuidedRoomRails(visibleListings) : null),
    [foodRoomOverview, visibleListings],
  );

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    setSelectedProduct(buildProductDetailPayload(product, categoryConfigs));
    setDetailOpen(true);
  }, [categoryConfigs]);

  const selectTile = useCallback((id: string | null) => {
    hapticSelection();
    const next = new URLSearchParams(searchParams);
    if (!id || id === tileId) next.delete('tile');
    else next.set('tile', id);
    next.delete('cuisine');
    setSearchParams(next);
  }, [searchParams, setSearchParams, tileId]);

  const selectCuisine = useCallback((id: FoodCuisineId | null) => {
    hapticSelection();
    const next = new URLSearchParams(searchParams);
    if (!id || id === cuisine) next.delete('cuisine');
    else next.set('cuisine', id);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, cuisine]);

  if (rawHubId && !isGuidedDiscoveryHubId(rawHubId)) {
    return <Navigate to="/" replace />;
  }

  const title = hubDefId ? guidedDiscoveryPageTitle(hubDefId, activeTile) : 'Explore';
  const subtitle = hubDefId
    ? guidedDiscoveryPageSubtitle(hubDefId, activeTile, listingSnapshot)
    : 'Browse what is available in your society';
  const seeAllHref = hubDefId ? guidedDiscoverySeeAllHref(hubDefId) : '/';
  const seeAllLabel = bookHub || contactHub ? 'View all' : 'See all';
  const backToAislesLabel = hubDefId === 'restaurant_food' ? 'All cuisines' : 'All meal times';

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader bordered={false} blur>
        <div className="px-4 pt-1 pb-2">
          {bookHub ? (
            <div className="flex items-center gap-1 min-h-11">
              <BackButton fallback="/" className="bg-transparent text-primary w-9 h-9" />
              <div className="min-w-0">
                <h1 className="text-[18px] font-extrabold truncate leading-tight" data-testid="guided-discovery-hub-title">
                  {title}
                </h1>
                <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center min-h-11">
              <BackButton
                fallback="/"
                className={cn('absolute left-0', contactHub && 'bg-transparent text-primary w-9 h-9')}
              />
              <div className="mx-12 min-w-0 flex-1 text-center">
                <h1
                  className={cn(
                    'text-[17px] font-extrabold truncate',
                    contactHub && 'text-primary',
                  )}
                  data-testid="guided-discovery-hub-title"
                >
                  {title}
                </h1>
                <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
              </div>
            </div>
          )}
        </div>
      </SafeHeader>

      <div
        className={cn(
          'pb-10',
          foodRoomOverview && 'guided-room-page',
          listingMode && foodHub && 'guided-listing-page',
        )}
        data-testid="guided-discovery-hub-page"
      >
        {roomHero && (hubDefId === 'home_food' || hubDefId === 'restaurant_food') && (
          <GuidedRoomHero
            hubId={hubDefId}
            imageUrl={dishHeroUrl}
            onOrderNow={() => {
              const target = document.getElementById('guided-room-kitchens')
                || document.getElementById('guided-discovery-popular');
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}
        {showHero && (
          <div className="relative overflow-hidden aspect-[16/8] bg-muted">
            <img
              src={optimizedImageUrl(hub?.imageUrl, { width: 800, quality: 76 })}
              alt=""
              className="h-full w-full object-cover"
              onError={handleImageError}
            />
          </div>
        )}

        {loading ? (
          <div className="px-4 mt-4 space-y-3">
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3, 4].map((key) => (
                <div key={key} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5">
                  <Skeleton className="h-14 w-14 rounded-full" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : !hub ? (
          <div className="px-6 py-16 text-center">
            <h2 className="text-sm font-semibold text-foreground">Nothing in this category in your society yet</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Try another category, or search for a seller nearby.
            </p>
            <div className="mt-4 flex flex-col gap-2 max-w-xs mx-auto">
              <Link to="/">
                <Button className="w-full">Back to home</Button>
              </Link>
              <Link to="/search">
                <Button variant="outline" className="w-full">Search</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {compactAisleStrip && (
              <div className={cn('relative z-10 mt-3', foodRoomOverview && 'mt-1')}>
                <div className="mb-3 px-4">
                  <p
                    className="text-[18px] font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50"
                    data-testid="guided-aisle-heading"
                  >
                    {aisleHeading}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {hubDefId === 'restaurant_food'
                      ? 'Pick a cuisine to narrow the shelf'
                      : 'Pick a meal time to narrow the shelf'}
                  </p>
                </div>
                <div className="discovery-chip-scroll scrollbar-hide" data-testid="guided-discovery-tiles">
                  <div className="flex w-max items-stretch gap-3 px-4 pr-6 pb-1">
                    {tiles.map((tile) => (
                      <GuidedDiscoveryOverlayTile
                        key={tile.id}
                        tile={tile}
                        selected={tile.id === tileId}
                        compact
                        showEta
                        onSelect={selectTile}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {foodRoomOverview && roomKitchens.length > 0 && (
              <div id="guided-room-kitchens" className="scroll-mt-24 mt-2">
                <CookingNearbyRail kitchens={roomKitchens} variant="room" />
              </div>
            )}

            {foodRoomOverview && roomRails && (
              <>
                <GuidedRoomSwipeRail
                  title={ROOM_BESTSELLERS_HEADING}
                  products={roomRails.bestsellers}
                  onProductTap={handleProductTap}
                  categoryConfigs={categoryConfigs}
                  testId="guided-room-bestsellers"
                  tone="warm"
                />
                <GuidedRoomSwipeRail
                  title={ROOM_VALUE_HEADING}
                  products={roomRails.underValue}
                  onProductTap={handleProductTap}
                  categoryConfigs={categoryConfigs}
                  testId="guided-room-value"
                  tone="plain"
                />
                <GuidedRoomSwipeRail
                  title={ROOM_READY_HEADING}
                  products={roomRails.readySoon}
                  onProductTap={handleProductTap}
                  categoryConfigs={categoryConfigs}
                  testId="guided-room-ready"
                  tone="cool"
                />
              </>
            )}

            {overlayGrid && (
              <div className="px-4 mt-4">
                <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary">
                  {bookHub && <Sparkles size={14} />}
                  {bookHub ? 'POPULAR SERVICES' : hubDefId === 'services' ? 'NEARBY HELP' : 'Choose a category'}
                </p>
                <div className="grid grid-cols-2 gap-3" data-testid="guided-discovery-tiles">
                  {overlayTiles.map((tile) => (
                    <GuidedDiscoveryOverlayTile
                      key={tile.id}
                      tile={tile}
                      selected={tile.id === tileId}
                      service={bookHub || hubDefId === 'services'}
                      onSelect={selectTile}
                    />
                  ))}
                </div>
              </div>
            )}

            {listingMode && foodHub && listingHeroUrl && (
              <div
                className="relative mx-4 mt-3 overflow-hidden rounded-[26px] border border-border/50 shadow-[0_22px_48px_-28px_rgba(15,23,42,0.55)] dark:border-white/10"
                data-testid="guided-listing-hero"
              >
                <div className="relative aspect-[16/9] min-h-[9.5rem] bg-zinc-900">
                  <img
                    src={optimizedImageUrl(listingHeroUrl, { width: 960, quality: 82 })}
                    alt=""
                    className="guided-room-ken-burns h-full w-full object-cover"
                    onError={handleImageError}
                  />
                  {listingSnapshot?.secondaryImageUrl && (
                    <img
                      src={optimizedImageUrl(listingSnapshot.secondaryImageUrl, { width: 360, quality: 76 })}
                      alt=""
                      className="absolute right-3 top-3 h-16 w-16 rounded-[16px] object-cover ring-2 ring-white/30 shadow-lg"
                      onError={handleImageError}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
                  <div className="guided-room-hero-sheen opacity-50" aria-hidden />
                  <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 pt-12">
                    <p className="text-[22px] font-extrabold tracking-tight text-white drop-shadow-sm">
                      {title}
                    </p>
                    {(listingSubline || listingSnapshot) && (
                      <p className="text-[12px] font-semibold text-white/85 line-clamp-2">
                        {listingSubline || (listingSnapshot ? guidedListingHeadline(listingSnapshot) : null)}
                      </p>
                    )}
                    {listingSnapshot && listingSnapshot.dishCount > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {listingSnapshot.priceFrom != null && (
                          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
                            {listingSnapshot.priceTo != null && listingSnapshot.priceTo > listingSnapshot.priceFrom
                              ? `${formatPrice(listingSnapshot.priceFrom)} - ${formatPrice(listingSnapshot.priceTo)}`
                              : `from ${formatPrice(listingSnapshot.priceFrom)}`}
                          </span>
                        )}
                        {listingSnapshot.prepLabel && (
                          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
                            {listingSnapshot.prepLabel}
                          </span>
                        )}
                        {listingSnapshot.openKitchenCount > 0 && (
                          <span className="rounded-full bg-emerald-500/90 px-2.5 py-1 text-[10px] font-extrabold text-white">
                            {listingSnapshot.openKitchenCount === listingSnapshot.kitchenCount
                              ? `${listingSnapshot.openKitchenCount} open`
                              : `${listingSnapshot.openKitchenCount}/${listingSnapshot.kitchenCount} open`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {listingMode && foodHub && cuisineChips.length > 0 && (
              <div className="taste-rail-scroll scrollbar-hide mt-3 sticky top-0 z-20 bg-background/85 backdrop-blur-md py-2.5 dark:bg-background/90" data-testid="guided-discovery-cuisine-chips">
                <div className="flex w-max gap-2 px-4 pr-5">
                  <button
                    type="button"
                    onClick={() => selectCuisine(null)}
                    className={cn(
                      'h-9 rounded-full px-4 text-[12px] font-extrabold transition-transform active:scale-[0.98]',
                      !cuisine
                        ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_-10px_hsl(var(--primary)/0.85)]'
                        : 'bg-card border border-border/80 text-foreground dark:border-white/14 dark:bg-card',
                    )}
                  >
                    All
                    {listingSnapshot && listingSnapshot.dishCount > 0 && !cuisine ? (
                      <span className="ml-1.5 tabular-nums text-primary-foreground/85">{listingSnapshot.dishCount}</span>
                    ) : null}
                  </button>
                  {cuisineChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => selectCuisine(chip.id)}
                      className={cn(
                        'h-9 rounded-full px-4 text-[12px] font-extrabold transition-transform active:scale-[0.98]',
                        cuisine === chip.id
                          ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_-10px_hsl(var(--primary)/0.85)]'
                          : 'bg-card border border-border/80 text-foreground dark:border-white/14 dark:bg-card',
                      )}
                    >
                      {chip.label}
                      {chip.count > 0 ? (
                        <span className={cn(
                          'ml-1.5 tabular-nums opacity-80',
                          cuisine === chip.id ? 'text-primary-foreground/85' : 'text-muted-foreground',
                        )}>
                          {chip.count}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={cn('px-4 mt-6', foodRoomOverview && 'mt-4', listingMode && 'mt-3')} id="guided-discovery-popular">
              {!listingMode && (
                <div className="mb-3.5 flex items-end justify-between gap-2">
                  <div>
                    <p className={cn(
                      contactHub
                        ? 'flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary'
                        : 'font-extrabold tracking-tight text-foreground',
                      foodRoomOverview ? 'text-[18px]' : 'text-[15px]',
                    )}>
                      {contactHub && <Users size={14} />}
                      {contactHub
                        ? 'Browse listings'
                        : bookHub
                          ? 'Popular services'
                          : (shelfHeading || 'Popular Today')}
                    </p>
                    {foodRoomOverview && overviewSnapshot && overviewSnapshot.dishCount > 0 && (
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                        {guidedListingHeadline(overviewSnapshot)}
                        {overviewSnapshot.prepLabel ? ` · ${overviewSnapshot.prepLabel}` : ''}
                      </p>
                    )}
                  </div>
                  <Link to={seeAllHref} className="inline-flex items-center gap-0.5 pb-0.5 text-xs font-bold text-primary">
                    {seeAllLabel}
                    <ChevronRight size={14} />
                  </Link>
                </div>
              )}
              {listingMode && listingSnapshot && (
                <div className="mb-3 flex items-end justify-between gap-2" data-testid="guided-listing-result-meta">
                  <div className="min-w-0">
                    <p className="text-[15px] font-extrabold tracking-tight text-foreground">
                      {guidedListingHeadline(listingSnapshot)}
                    </p>
                    {listingSubline && (
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground truncate">
                        {listingSubline}
                      </p>
                    )}
                  </div>
                  {tileId && (
                    <button
                      type="button"
                      onClick={() => selectTile(null)}
                      className="shrink-0 text-[11px] font-bold text-primary"
                    >
                      {backToAislesLabel}
                    </button>
                  )}
                </div>
              )}
              {contactHub ? (
                overviewSellers.length > 0 ? (
                  <div className="space-y-3">
                    {overviewSellers.map((group) => (
                      <GuidedDiscoverySellerCard
                        key={group[0].seller_id}
                        products={group}
                        categoryLabel={categoryMeta.find((meta) => meta.category === group[0].category)?.displayName || group[0].category}
                        categoryConfigs={categoryConfigs}
                        onOpenListing={handleProductTap}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyList title={title} onReset={() => selectTile(null)} />
                )
              ) : overviewListings.length > 0 ? (
                <div className={cn(
                  shopGrid ? 'grid grid-cols-2 gap-2.5' : 'space-y-3',
                )}>
                  {overviewListings.map((product, index) => (
                    <GuidedDiscoveryProductRow
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      categoryConfigs={categoryConfigs}
                      dense={shopGrid}
                      index={index}
                    />
                  ))}
                </div>
              ) : (
                <EmptyList title={title} onReset={() => selectTile(null)} />
              )}
            </div>

            {foodRoomOverview && (hubDefId === 'home_food' || hubDefId === 'restaurant_food') && (
              <div
                className="relative mx-4 mt-8 mb-2 overflow-hidden rounded-[24px] border border-border/60 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]"
                data-testid="guided-room-continue"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-950" aria-hidden />
                <div className="guided-room-hero-sheen opacity-60" aria-hidden />
                <div className="relative z-10 px-4 py-5">
                  <p className="text-[11px] font-extrabold tracking-[0.16em] text-[#F5C542]">
                    STILL HUNGRY?
                  </p>
                  <p className="mt-1 text-[17px] font-extrabold tracking-tight text-white">
                    Keep exploring
                  </p>
                  <p className="mt-1 text-[12px] text-white/75">
                    More kitchens and dishes in your society.
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <Link
                      to={roomContinueHref(hubDefId)}
                      onClick={() => hapticSelection()}
                      className="inline-flex h-11 items-center justify-center gap-1 rounded-full bg-[#F5C542] px-4 text-[13px] font-extrabold text-zinc-900 active:scale-[0.99]"
                    >
                      {roomContinueLabel(hubDefId)}
                      <ChevronRight size={15} />
                    </Link>
                    <Link
                      to={seeAllHref}
                      onClick={() => hapticSelection()}
                      className="inline-flex h-11 items-center justify-center gap-1 rounded-full border border-white/25 bg-white/10 px-4 text-[13px] font-bold text-white backdrop-blur-sm active:scale-[0.99]"
                    >
                      {seeAllLabel} in {title}
                      <ChevronRight size={15} />
                    </Link>
                  </div>
                </div>
              </div>
            )}
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

function EmptyList({ title, onReset }: { title: string; onReset: () => void }) {
  return (
    <div className="rounded-[22px] border border-dashed border-border/80 bg-card/70 px-4 py-12 text-center shadow-[0_12px_28px_-24px_rgba(15,23,42,0.35)] dark:border-white/12 dark:bg-card/50">
      <p className="text-[15px] font-extrabold tracking-tight text-foreground">
        No {title.toLowerCase()} nearby right now
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Clear filters to see everything available for {title}.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-[12px] font-extrabold text-primary-foreground shadow-[0_10px_22px_-10px_hsl(var(--primary)/0.85)] active:scale-[0.98]"
      >
        Show all in {title}
      </button>
    </div>
  );
}
