import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Sparkles, Users } from 'lucide-react';
import { NeighborMakesBanner } from '@/components/home/NeighborMakesBanner';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { BackButton } from '@/components/navigation/BackButton';
import { type ProductWithSeller } from '@/components/product/ProductListingCard';
import { GuidedDiscoveryOverlayTile } from '@/components/discovery/GuidedDiscoveryOverlayTile';
import { GuidedDiscoveryProductRow } from '@/components/discovery/GuidedDiscoveryProductRow';
import { GuidedDiscoverySellerCard } from '@/components/discovery/GuidedDiscoverySellerCard';
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
  filterGuidedDiscoveryListings,
  guidedDiscoveryPageSubtitle,
  guidedDiscoveryPageTitle,
  guidedDiscoverySeeAllHref,
  isGuidedDiscoveryHubId,
  listingsForGuidedHub,
  type GuidedDiscoveryCategoryMeta,
} from '@/lib/guided-discovery';
import { parseCuisineParam, type FoodCuisineId } from '@/lib/food-facets';
import { pickDishListingPhoto } from '@/lib/chip-listing-photo';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

const OVERVIEW_PRODUCT_CAP = 8;
const OVERVIEW_SELLER_CAP = 6;

export default function GuidedDiscoveryHubPage() {
  const { hubId: rawHubId } = useParams<{ hubId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tileId = searchParams.get('tile');
  const cuisine = parseCuisineParam(searchParams.get('cuisine'));

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
  const compactMealStrip = hubDefId === 'home_food' && !listingMode;
  const overlayTiles = bookHub ? tiles.slice(0, 4) : tiles;
  const overlayGrid = !listingMode && !compactMealStrip && !contactHub && overlayTiles.length > 0;
  const shopGrid = !listingMode && !contactHub && !bookHub && hubDefId !== 'services';
  const homeFoodHero = hubDefId === 'home_food' && !listingMode;
  const showHero = !listingMode && !homeFoodHero && !!hub?.imageUrl && hub.kind === 'shop_categories';
  const dishHeroUrl = homeFoodHero ? pickDishListingPhoto(visibleListings) || hub?.imageUrl || null : null;
  const overviewListings = listingMode ? visibleListings : visibleListings.slice(0, OVERVIEW_PRODUCT_CAP);
  const overviewSellers = listingMode ? sellerGroups : sellerGroups.slice(0, OVERVIEW_SELLER_CAP);

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
    ? guidedDiscoveryPageSubtitle(hubDefId, activeTile)
    : 'Browse what is available in your society';
  const seeAllHref = hubDefId ? guidedDiscoverySeeAllHref(hubDefId) : '/';
  const seeAllLabel = bookHub || contactHub ? 'View all' : 'See all';

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

      <div className="pb-8" data-testid="guided-discovery-hub-page">
        {homeFoodHero && (
          <NeighborMakesBanner
            imageUrl={dishHeroUrl}
            onOrderNow={() => {
              document.getElementById('guided-discovery-popular')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            <div className="flex gap-2 overflow-hidden">
              {[1, 2, 3, 4].map((key) => (
                <Skeleton key={key} className="h-32 w-24 rounded-2xl shrink-0" />
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
            {compactMealStrip && (
              <div className="mt-4">
                <p className="px-4 mb-2.5 text-[15px] font-extrabold tracking-tight text-foreground">
                  Browse by meal time
                </p>
                <div className="taste-rail-scroll scrollbar-hide" data-testid="guided-discovery-tiles">
                  <div className="flex w-max gap-2.5 px-4 pr-5">
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

            {listingMode && foodHub && cuisineChips.length > 0 && (
              <div className="taste-rail-scroll scrollbar-hide mt-3" data-testid="guided-discovery-cuisine-chips">
                <div className="flex w-max gap-2 px-4 pr-5">
                  <button
                    type="button"
                    onClick={() => selectCuisine(null)}
                    className={cn(
                      'h-8 rounded-full px-3.5 text-[12px] font-bold',
                      !cuisine ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground',
                    )}
                  >
                    All
                  </button>
                  {cuisineChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => selectCuisine(chip.id)}
                      className={cn(
                        'h-8 rounded-full px-3.5 text-[12px] font-bold',
                        cuisine === chip.id ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground',
                      )}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 mt-6" id="guided-discovery-popular">
              {!listingMode && (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className={cn(
                    contactHub
                      ? 'flex items-center gap-1.5 text-[13px] font-extrabold tracking-[0.12em] text-primary'
                      : 'text-[15px] font-extrabold tracking-tight text-foreground',
                  )}>
                    {contactHub && <Users size={14} />}
                    {contactHub ? 'Browse listings' : bookHub ? 'Popular services' : 'Popular Today'}
                  </p>
                  <Link to={seeAllHref} className="inline-flex items-center gap-0.5 text-xs font-bold text-primary">
                    {seeAllLabel}
                    <ChevronRight size={14} />
                  </Link>
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
                  shopGrid ? 'grid grid-cols-2 gap-2.5' : 'space-y-2.5',
                )}>
                  {overviewListings.map((product) => (
                    <GuidedDiscoveryProductRow
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      categoryConfigs={categoryConfigs}
                      dense={shopGrid}
                    />
                  ))}
                </div>
              ) : (
                <EmptyList title={title} onReset={() => selectTile(null)} />
              )}
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

function EmptyList({ title, onReset }: { title: string; onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        Nothing in this category in your society yet
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 text-xs font-semibold text-primary hover:underline"
      >
        Show all in {title}
      </button>
    </div>
  );
}
