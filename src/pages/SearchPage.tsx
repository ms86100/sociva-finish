// @ts-nocheck
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { staggerGrid, cardEntrance } from '@/lib/motion-variants';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { SearchFilters } from '@/components/search/SearchFilters';
import { FilterPresets } from '@/components/search/FilterPresets';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { MarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { BadgeConfigRow } from '@/hooks/useBadgeConfig';
import { ArrowLeft, Search as SearchIcon, X, Globe, ShoppingBag } from 'lucide-react';
import { LottieEmptyState } from '@/components/ui/LottieEmptyState';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { TypewriterPlaceholder } from '@/components/search/TypewriterPlaceholder';
import { useCurrency } from '@/hooks/useCurrency';
import { useSearchPage, ProductSearchResult } from '@/hooks/useSearchPage';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { applyProductFacetRow, useProductFacets, type ProductFacetRow } from '@/hooks/queries/useProductFacets';
import { isFoodParentGroup } from '@/lib/food-facets';
import { CommunitySuggestions } from '@/components/search/CommunitySuggestions';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { CategoryPhotoChipRail, buildLeafPhotoChipItems } from '@/components/category/CategoryPhotoChipRail';
import { type ProductDetail } from '@/hooks/useProductDetail';
import { useSearchKeyboardInset } from '@/hooks/useChatViewport';
import { selectSearchResultsForDisplay } from '@/lib/searchRanking';
import { diversifyRankedProducts, shouldDiversifySort } from '@/lib/sellerDiversity';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

function toProductWithSeller(p: ProductSearchResult, row?: ProductFacetRow | null, seller?: any): ProductWithSeller {
  return applyProductFacetRow({
    id: p.product_id, seller_id: p.seller_id, name: p.product_name, price: p.price,
    image_url: p.image_url, is_veg: p.is_veg, is_available: true,
    is_bestseller: (p as any).is_bestseller ?? false,
    is_recommended: (p as any).is_recommended ?? false,
    is_urgent: (p as any).is_urgent ?? false,
    category: p.category || '', description: p.description || null,
    mrp: p.mrp || null, discount_percentage: p.discount_percentage || null,
    distance_km: p.distance_km || null, society_name: p.society_name || null,
    is_same_society: p.is_same_society, created_at: '', updated_at: '',
    seller_name: p.seller_name, seller_rating: p.seller_rating,
    fulfillment_mode: p.fulfillment_mode || null, delivery_note: p.delivery_note || null,
    seller_fulfillment_mode: seller?.fulfillment_mode || (p as any).seller_fulfillment_mode || p.fulfillment_mode || null,
    home_service_available: (p as any).home_service_available ?? null,
    seller_home_service_available: seller?.home_service_available === true || (p as any).seller_home_service_available === true,
    home_service_fee: seller?.home_service_fee ?? (p as any).home_service_fee ?? null,
    action_type: p.action_type || null, contact_phone: p.contact_phone || null,
    tags: p.tags || null, cuisine_type: p.cuisine_type || null,
    prep_time_minutes: p.prep_time_minutes || null,
  } as ProductWithSeller, row);
}

export default function SearchPage() {
  const s = useSearchPage();
  const { data: marketplaceSellers } = useMarketplaceData();
  const sellersById = useMemo(() => {
    const map = new Map<string, any>();
    for (const seller of marketplaceSellers || []) map.set(seller.seller_id, seller);
    return map;
  }, [marketplaceSellers]);
  const keyboard = useSearchKeyboardInset(true);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);

  useEffect(() => {
    setShowAllResults(false);
  }, [s.query, s.selectedCategory, s.filters]);

  const foodCategorySet = useMemo(
    () => new Set(s.categoryConfigs.filter((c) => isFoodParentGroup(c.parentGroup)).map((c) => c.category)),
    [s.categoryConfigs],
  );
  const hasFoodResults = s.displayProducts.some((p) => p.category && foodCategorySet.has(p.category));
  const productIds = useMemo(() => s.displayProducts.map((p) => p.product_id), [s.displayProducts]);
  const { data: facetRows = {} } = useProductFacets(productIds, productIds.length > 0);

  const rankedSearch = useMemo(() => {
    const ranked = selectSearchResultsForDisplay(s.query, s.displayProducts, s.isSearchActive && s.query.trim().length >= 2);
    if (!shouldDiversifySort(s.filters.sortBy)) return ranked;
    const items = diversifyRankedProducts(ranked.items, {
      sellerId: (product) => product.seller_id,
      base: (_product, index) => ranked.items.length - index,
      createdAt: (product) => product.created_at,
    });
    return {
      items,
      preview: items.slice(0, ranked.preview.length),
      hiddenCount: Math.max(0, items.length - ranked.preview.length),
    };
  }, [s.query, s.displayProducts, s.isSearchActive, s.filters.sortBy]);
  const visibleProducts = s.isSearchActive && s.query.trim().length >= 2 && !showAllResults
    ? rankedSearch.preview
    : rankedSearch.items;

  const handleProductTap = (product: ProductWithSeller) => {
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
      seller_fulfillment_mode: product.seller_fulfillment_mode || product.fulfillment_mode,
      home_service_available: product.home_service_available ?? null,
      seller_home_service_available: product.seller_home_service_available === true,
      home_service_fee: product.home_service_fee ?? null,
      delivery_note: product.delivery_note,
      action_type: product.action_type,
      contact_phone: product.contact_phone,
      seller_id: product.seller_id,
      seller_name: product.seller_name || '',
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      society_name: (product as any).society_name || null,
      distance_km: (product as any).distance_km || null,
      is_same_society: (product as any).is_same_society ?? true,
    });
    setDetailOpen(true);
  };

  return (
    <AppLayout
      showHeader={false}
      showNav={!keyboard.isKeyboardOpen}
      safeTop={false}
      className={keyboard.isKeyboardOpen ? 'pb-3' : undefined}
    >
      <div
        className={keyboard.isKeyboardOpen ? undefined : 'pb-24'}
        style={keyboard.resultsPaddingBottom ? { paddingBottom: keyboard.resultsPaddingBottom } : undefined}
      >
        {/* Sticky search header */}
        <SafeHeader zIndex="z-40" bordered={false} className="overflow-visible">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <button onClick={() => s.navigate('/')} className="shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center"><ArrowLeft size={18} className="text-foreground" /></button>
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                {!s.query && <div className="absolute left-9 top-1/2 -translate-y-1/2 pointer-events-none pr-16 overflow-hidden whitespace-nowrap max-w-[calc(100%-4rem)]"><TypewriterPlaceholder context="search" /></div>}
                <Input
                  placeholder=""
                  value={s.query}
                  onChange={(e) => s.setQuery(e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  inputMode="search"
                  className="pl-9 pr-16 h-10 rounded-xl text-sm bg-muted border-0 focus-visible:ring-1"
                  ref={(el) => { if (el) setTimeout(() => el.focus(), 300); }}
                />
                {s.query && <button onClick={() => s.setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
                <SearchAutocomplete
                  query={s.query}
                  maxHeight={keyboard.autocompleteMaxHeight}
                  onSelect={(p) => { s.setQuery(''); setSelectedProduct(p); setDetailOpen(true); }}
                />
              </div>
            </div>
          </div>
          {/* Filter bar */}
          <div className="px-4 pb-2">
            <div className="taste-rail-scroll">
              <div className="flex items-center gap-2">
                <SearchFilters
                  filters={s.filters}
                  onFiltersChange={s.handleFiltersChange}
                  showPriceFilter
                  showDietary={hasFoodResults}
                  browseBeyond={s.browseBeyond}
                  onBrowseBeyondChange={s.setBrowseBeyond}
                  searchRadius={s.searchRadius}
                  onSearchRadiusChange={s.setSearchRadiusLocal}
                  onSearchRadiusCommit={s.setSearchRadius}
                />
                {hasFoodResults && (
                  <>
                    <button onClick={() => s.setFilters({ ...s.filters, isVeg: s.filters.isVeg === true ? null : true })} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.isVeg === true ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-background text-foreground'}`}>
                      <div className="w-3 h-3 border-[1.5px] border-accent rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-accent" /></div>Veg
                    </button>
                    <button onClick={() => s.setFilters({ ...s.filters, isVeg: s.filters.isVeg === false ? null : false })} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.isVeg === false ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border bg-background text-foreground'}`}>
                      <div className="w-3 h-3 border-[1.5px] border-destructive rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-destructive" /></div>Non-veg
                    </button>
                  </>
                )}
                {([{ value: 'rating' as const, label: 'Top Rated' }, { value: 'price_low' as const, label: 'Price ↑' }, { value: 'price_high' as const, label: 'Price ↓' }, { value: 'nearest' as const, label: 'Nearest' }]).map(({ value, label }) => (
                  <button key={value} onClick={() => s.setFilters({ ...s.filters, sortBy: s.filters.sortBy === value ? null : value })} className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.sortBy === value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-foreground'}`}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        </SafeHeader>

        {s.needsPreciseLocation && <PreciseLocationRequiredCard className="mx-4 mt-3" />}

        <div className="px-4">
          {/* Community search suggestions */}
          {!s.isSearchActive && (
            <CommunitySuggestions onSuggestionTap={(term) => s.setQuery(term)} />
          )}

          {/* Leaf-category filters - identical CategoryPhotoChipRail + buildLeafPhotoChipItems as Home */}
          <CategoryPhotoChipRail
            className="mb-3"
            railClassName="py-1"
            items={buildLeafPhotoChipItems(
              s.categoryConfigs,
              s.popularProducts.map((p) => p.category).filter(Boolean),
            )}
            selectedId={s.selectedCategory}
            onSelect={s.handleCategoryTap}
            isLoading={s.categoriesLoading || s.isLoadingPopular}
            allowDeselect
          />

          {/* Filter presets */}
          <FilterPresets activePreset={s.activePreset} onPresetSelect={s.handlePresetSelect} includeVeg={hasFoodResults} />

          {/* Active filter pills */}
          {s.pills.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
              {s.pills.map((label, i) => <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium whitespace-nowrap">{label}</span>)}
              <button onClick={s.clearFilters} className="text-[11px] text-muted-foreground underline whitespace-nowrap ml-1">Clear</button>
            </div>
          )}

          {/* Results */}
          {s.showLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2.5 mt-2">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
            </div>
          ) : visibleProducts.length > 0 ? (
            <>
              <ProductGridByCategory products={visibleProducts} facetRows={facetRows} sellersById={sellersById} categoryMap={s.categoryMap} categoryConfigs={s.categoryConfigs} marketplaceConfig={s.mc} badgeConfigs={s.badgeConfigs} showCount={s.isSearchActive} totalCount={rankedSearch.items.length} onNavigate={s.navigate} onProductTap={handleProductTap} />
              {rankedSearch.hiddenCount > 0 && !showAllResults && (
                <button
                  type="button"
                  onClick={() => setShowAllResults(true)}
                  className="w-full mt-4 mb-2 h-11 rounded-xl border border-border bg-card text-sm font-semibold text-foreground"
                >
                  Show {rankedSearch.hiddenCount} more result{rankedSearch.hiddenCount === 1 ? '' : 's'}
                </button>
              )}
            </>
          ) : s.isSearchActive ? (
            <EmptyState browseBeyond={s.browseBeyond} onEnableBrowseBeyond={() => s.setBrowseBeyond(true)} />
          ) : (
            <EmptyMarketplace />
          )}
        </div>
      </div>

        {detailOpen && (
          <Suspense fallback={null}>
            <ProductDetailSheet
              product={selectedProduct}
              open={detailOpen}
              onOpenChange={setDetailOpen}
              onSelectProduct={(sp) => {
                setSelectedProduct({
                  product_id: sp.id,
                  product_name: sp.name,
                  price: sp.price,
                  image_url: sp.image_url,
                  is_veg: sp.is_veg,
                  category: sp.category,
                  description: sp.description || null,
                  seller_id: sp.seller_id,
                  seller_name: sp.seller?.business_name || '',
                  seller_rating: 0,
                  seller_reviews: 0,
                  action_type: sp.action_type,
                });
              }}
            />
          </Suspense>
        )}
    </AppLayout>
  );
}

// ── Product Grid By Category ──
function ProductGridByCategory({ products, facetRows, sellersById, categoryMap, categoryConfigs, marketplaceConfig, badgeConfigs, showCount, totalCount, onNavigate, onProductTap }: {
  products: ProductSearchResult[];
  facetRows?: Record<string, ProductFacetRow>;
  sellersById: Map<string, any>;
  categoryMap: Record<string, { icon: string; displayName: string; color: string; imageUrl?: string | null }>;
  categoryConfigs: { category: string; displayName: string; icon: string; imageUrl?: string; behavior?: any }[];
  marketplaceConfig?: MarketplaceConfig;
  badgeConfigs?: BadgeConfigRow[];
  showCount?: boolean;
  totalCount?: number;
  onNavigate?: (path: string) => void;
  onProductTap?: (product: ProductWithSeller) => void;
}) {
  const { formatPrice } = useCurrency();
  const grouped = useMemo(() => {
    const g: Record<string, ProductSearchResult[]> = {};
    products.forEach((p) => { const cat = p.category || 'other'; if (!g[cat]) g[cat] = []; g[cat].push(p); });
    return g;
  }, [products]);

  return (
    <div className="mt-2 space-y-5">
      {showCount && (() => {
        const n = totalCount ?? products.length;
        return (
          <p className="text-xs text-muted-foreground">
            {`${n} ${n === 1 ? 'item' : 'items'} found`}
            {totalCount != null && totalCount > products.length ? ` · showing top ${products.length}` : ''}
          </p>
        );
      })()}
      {Object.keys(grouped).map((cat) => {
        const items = grouped[cat];
        const catInfo = categoryMap[cat];
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md overflow-hidden flex items-center justify-center shrink-0 bg-muted">
                {catInfo?.imageUrl ? (
                  <img src={catInfo.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-base leading-none"><DynamicIcon name={catInfo?.icon || 'Package'} size={14} /></span>
                )}
              </div>
              <h3 className="font-bold text-sm text-foreground">{catInfo?.displayName || cat}</h3>
              <span className="text-xs text-muted-foreground">({items.length})</span>
              <span className="text-[11px] font-semibold text-accent ml-auto">From {formatPrice(Math.min(...items.map(p => p.price)))}</span>
            </div>
            <motion.div
              className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3.5"
              variants={staggerGrid}
              initial="hidden"
              animate="show"
              key={cat}
            >
              {items.map((p) => (
                <motion.div key={p.product_id} variants={cardEntrance}>
                  <ProductListingCard product={toProductWithSeller(p, facetRows?.[p.product_id], sellersById.get(p.seller_id))} categoryConfigs={categoryConfigs as any} marketplaceConfig={marketplaceConfig} badgeConfigs={badgeConfigs} onNavigate={onNavigate} onTap={onProductTap} />
                </motion.div>
              ))}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

// ── Empty States ──
function EmptyState({ browseBeyond, onEnableBrowseBeyond }: { browseBeyond?: boolean; onEnableBrowseBeyond?: () => void }) {
  return (
    <motion.div
      className="text-center py-12 space-y-4"
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
    >
      <LottieEmptyState
        emoji="🔍"
        title="No results found"
        description="Nothing nearby matches this search yet."
      >
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Try browsing by category, or <Link to="/become-seller" className="text-primary font-semibold hover:underline">become the first to offer it</Link>.</p>
          {!browseBeyond && onEnableBrowseBeyond && (
            <button onClick={onEnableBrowseBeyond} className="text-sm text-primary font-medium hover:underline flex items-center gap-1 mx-auto"><Globe size={14} /> Search nearby societies too</button>
          )}
        </div>
      </LottieEmptyState>
    </motion.div>
  );
}

function EmptyMarketplace() {
  return (
    <motion.div
      className="text-center py-16 space-y-4"
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
    >
      <div className="mx-auto w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center"><ShoppingBag size={36} className="text-primary" /></div>
      <div><p className="font-bold text-lg">Your marketplace is getting ready!</p><p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">Sellers in your community haven't listed products yet. Check back soon or search for something specific.</p></div>
    </motion.div>
  );
}
