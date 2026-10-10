import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CalendarCheck, PackageSearch, ShoppingBag, Wrench } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ParentGroupTabs } from '@/components/home/ParentGroupTabs';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { ProductListingCard, type ProductWithSeller } from '@/components/product/ProductListingCard';
import { ProductCardSkeleton } from '@/components/product/ProductCardSkeleton';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { Button } from '@/components/ui/button';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useCommerceModeListings } from '@/hooks/queries/useCommerceModeListings';
import { applyProductFacetRow, useProductFacets } from '@/hooks/queries/useProductFacets';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';
import type { CommerceMode } from '@/lib/commerce-mode';
import {
  type CommerceFacetState,
  emptyCommerceFacetState,
  extractAvailableCommerceFacets,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
} from '@/lib/commerce-facets';
import { buildProductDetailPayload, buildRelatedProductDetailPayload } from '@/lib/product-detail-payload';
import { cn } from '@/lib/utils';

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
    title: 'Book',
    subtitle: 'Reserve a slot with providers near you',
    empty: 'Nothing to book nearby yet',
    emptyHint: 'No classes, sessions or appointments are open for booking near you yet.',
  },
  services: {
    title: 'Services',
    subtitle: 'Request a quote or contact pros near you',
    empty: 'No services nearby yet',
    emptyHint: 'No local professionals are taking enquiries near you yet.',
  },
};

const MODE_ACCENT: Record<CommerceMode, { chip: string; icon: typeof ShoppingBag }> = {
  shop: { chip: 'bg-mode-shop text-mode-shop-foreground', icon: ShoppingBag },
  book: { chip: 'bg-mode-book text-mode-book-foreground', icon: CalendarCheck },
  services: { chip: 'bg-mode-services text-mode-services-foreground', icon: Wrench },
};

export function commerceModeFromPath(pathname: string): CommerceMode {
  if (pathname.startsWith('/book')) return 'book';
  if (pathname.startsWith('/services')) return 'services';
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

  const { listings, categoryConfigs, isLoading, topUpError, retryTopUp } = useCommerceModeListings(mode);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [facets, setFacets] = useState<CommerceFacetState>(emptyCommerceFacetState());
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

  const modeCategories = useMemo(() => new Set(enriched.map((p) => p.category)), [enriched]);
  const activeGroup = activeCategory
    ? categoryConfigs.find((c) => c.category === activeCategory)?.parentGroup ?? null
    : null;

  const scoped = useMemo(
    () => (activeCategory ? enriched.filter((p) => p.category === activeCategory) : enriched),
    [enriched, activeCategory],
  );

  const facetChips = useMemo(() => {
    const chips = extractAvailableCommerceFacets(scoped, { parentGroup: activeGroup, currentState: facets, categoryConfigs });
    const actionChips = chips.filter((c) => c.type === 'action_type');
    return actionChips.length > 1 ? chips : chips.filter((c) => c.type !== 'action_type');
  }, [scoped, activeGroup, facets, categoryConfigs]);

  const visible = useMemo(
    () => (hasActiveCommerceFacets(facets)
      ? scoped.filter((p) => productMatchesCommerceFacets(p, facets, categoryConfigs))
      : scoped),
    [scoped, facets, categoryConfigs],
  );

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    setSelectedProduct(buildProductDetailPayload(product, categoryConfigs));
    setDetailOpen(true);
  }, [categoryConfigs]);

  const resetFilters = useCallback(() => {
    setActiveCategory(null);
    setFacets(emptyCommerceFacetState());
  }, []);

  const hasListings = enriched.length > 0;

  return (
    <AppLayout>
      <div data-testid={`commerce-mode-${mode}`} data-mode={mode} className="pb-4">
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <span className={cn('w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', accent.chip)}>
            <ModeIcon size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-display-sm text-foreground truncate">{copy.title}</h1>
            <p className="text-xs text-muted-foreground truncate">{copy.subtitle}</p>
          </div>
          {!isLoading && hasListings && (
            <span className="text-xs font-semibold text-muted-foreground tabular-nums" data-testid="commerce-mode-count">
              {enriched.length} listing{enriched.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {needsPreciseLocation ? (
          <PreciseLocationRequiredCard />
        ) : (
          <>
            {hasListings && (
              <>
                <ParentGroupTabs
                  activeCategory={activeCategory}
                  onCategoryChange={(cat) => {
                    setActiveCategory(cat);
                    setFacets(emptyCommerceFacetState());
                  }}
                  activeCategories={modeCategories}
                />
                <CommerceFacetRail
                  value={facets}
                  onChange={setFacets}
                  chips={facetChips}
                  parentGroup={activeGroup}
                  className="py-1"
                  inventory={scoped}
                />
              </>
            )}

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

            <div className="px-3 sm:px-4 pt-2">
              {isLoading ? (
                <div data-testid="commerce-mode-loading">
                  <ProductCardSkeleton count={9} />
                </div>
              ) : visible.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3" data-testid="commerce-mode-grid">
                  {visible.map((product) => (
                    <ProductListingCard
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      onNavigate={navigate}
                      categoryConfigs={categoryConfigs}
                    />
                  ))}
                </div>
              ) : hasListings ? (
                <div className="p-6 rounded-2xl bg-muted/40 text-center border border-dashed border-border">
                  <p className="text-sm font-medium text-foreground">No listings match these filters</p>
                  <button onClick={resetFilters} className="mt-2 text-xs text-primary font-semibold hover:underline">
                    Reset filters
                  </button>
                </div>
              ) : !topUpError ? (
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
