// @ts-nocheck
import { useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { SellerCard } from '@/components/seller/SellerCard';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useCategoryProducts } from '@/hooks/queries/usePopularProducts';
import { ServiceCategory } from '@/types/categories';
import { SortKey } from '@/lib/marketplace-constants';
import { BackButton } from '@/components/navigation/BackButton';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { applyProductFacetRow, useProductFacets } from '@/hooks/queries/useProductFacets';
import { CommerceFacetRail } from '@/components/discovery/CommerceFacetRail';
import { DiscoveryChipRail } from '@/components/home/DiscoveryChipRail';
import { relevantBrowseIntents } from '@/lib/discovery-intents';
import {
  CommerceFacetState,
  emptyCommerceFacetState,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
  extractAvailableCommerceFacets,
  omitSoleActionChips,
} from '@/lib/commerce-facets';
import {
  listingMatchesCategoryChip,
  productMatchesFoodFacets,
  readFoodFacetsFromSearchParams,
  TASTE_MOODS,
  writeFoodFacetsToSearchParams,
} from '@/lib/food-facets';
import { diversifyRankedProducts, shouldDiversifySort } from '@/lib/sellerDiversity';

export default function CategoryGroupPage() {
  const { category } = useParams<{ category: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSubCategory = searchParams.get('sub') as ServiceCategory | null;

  const { groupedConfigs, configs: categoryConfigs, isLoading: configsLoading } = useCategoryConfigs();
  const { getGroupBySlug, isLoading: groupsLoading } = useParentGroups();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('relevance');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
      seller_id: product.seller_id,
      seller_name: product.seller_name || '',
      seller_profile_image_url: (product as any).seller_profile_image_url || product.seller?.profile_image_url || null,
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      action_type: product.action_type,
      contact_phone: product.contact_phone,
      prep_time_minutes: product.prep_time_minutes,
      fulfillment_mode: product.fulfillment_mode,
      seller_fulfillment_mode: product.seller_fulfillment_mode || product.fulfillment_mode,
      home_service_available: product.home_service_available ?? null,
      seller_home_service_available: product.seller_home_service_available === true,
      home_service_fee: product.home_service_fee ?? null,
      delivery_note: product.delivery_note,
      _catIcon: catConfig?.icon || '🛍️',
      _catName: catConfig?.displayName || product.category,
    });
    setDetailOpen(true);
  }, [categoryConfigs]);

  const parentFromRoute = category ? getGroupBySlug(category) : undefined;
  const leafFromRoute = !parentFromRoute && category
    ? categoryConfigs.find((config) => config.category === category)
    : null;
  const parentGroup = parentFromRoute
    || (leafFromRoute ? getGroupBySlug(leafFromRoute.parentGroup) : undefined);
  const routeLeaf = parentFromRoute ? activeSubCategory : (activeSubCategory || category || null);
  const catalogKey = parentGroup?.value || leafFromRoute?.parentGroup || null;
  const allSubCategories = catalogKey ? groupedConfigs[catalogKey] || [] : [];

  const { data: allProducts = [], isLoading: productsLoading } = useCategoryProducts(
    catalogKey,
    routeLeaf,
  );

  const productIds = useMemo(() => allProducts.map((p) => p.id), [allProducts]);
  const { data: facetRows = {} } = useProductFacets(productIds, productIds.length > 0);
  const productsWithFacets = useMemo(
    () => allProducts.map((p) => applyProductFacetRow(p, facetRows[p.id])),
    [allProducts, facetRows],
  );

  const foodFromUrl = readFoodFacetsFromSearchParams(searchParams);
  const [facetExtras, setFacetExtras] = useState<CommerceFacetState>(emptyCommerceFacetState);
  const facets: CommerceFacetState = {
    ...facetExtras,
    cuisine: foodFromUrl.cuisine,
    meal: foodFromUrl.meal,
    course: foodFromUrl.course,
  };

  const scopedProducts = useMemo(() => {
    return routeLeaf
      ? productsWithFacets.filter((p) => listingMatchesCategoryChip(p, routeLeaf))
      : productsWithFacets;
  }, [productsWithFacets, routeLeaf]);

  const dynamicFacetChips = useMemo(() => {
    return omitSoleActionChips(extractAvailableCommerceFacets(scopedProducts, {
      parentGroup: catalogKey || category,
      currentState: facets,
      categoryConfigs,
    })).filter((chip) => chip.type !== 'food_mood');
  }, [scopedProducts, catalogKey, facets, categoryConfigs]);

  const browseGroups = useMemo(() => {
    return allSubCategories
      .map((config) => ({
        category: config.category,
        parentGroup: catalogKey || config.parentGroup,
        displayName: config.displayName,
        icon: config.icon,
        imageUrl: config.imageUrl || config.image_url || null,
        products: productsWithFacets.filter((product) => product.category === config.category),
      }))
      .filter((group) => group.products.length > 0);
  }, [allSubCategories, productsWithFacets, catalogKey]);

  const browseIntents = useMemo(
    () => relevantBrowseIntents(browseGroups, {
      category: routeLeaf,
      facets: foodFromUrl,
    }),
    [browseGroups, routeLeaf, foodFromUrl],
  );

  const selectedBrowseIds = useMemo(() => {
    const ids: string[] = [];
    if (routeLeaf) ids.push(`cat:${routeLeaf}`);
    for (const mood of TASTE_MOODS) {
      if (facets[mood.facet] === mood.value) ids.push(`mood:${mood.id}`);
    }
    return ids;
  }, [routeLeaf, facets]);

  // Derive top sellers from shared marketplace data (no N+1 RPC loop)
  const { data: marketplaceSellers } = useMarketplaceData();
  const topSellers = useMemo(() => {
    if (!marketplaceSellers || !category) return [];
    const configs: any[] | undefined = queryClient.getQueryData(['category-configs']);
    const categorySet = new Set(
      (configs || [])
        .filter((c: any) => (c.parent_group || c.parentGroup) === category)
        .map((c: any) => c.category)
    );
    if (categorySet.size === 0) return [];

    const sellerMap = new Map<string, any>();
    for (const s of marketplaceSellers) {
      const items = s.matching_products;
      if (!Array.isArray(items)) continue;
      const categoryProducts = items.filter((p: any) => categorySet.has(p.category));
      if (categoryProducts.length === 0) continue;
      if (!sellerMap.has(s.seller_id)) {
        sellerMap.set(s.seller_id, {
          id: s.seller_id,
          business_name: s.business_name,
          description: s.description ?? null,
          profile_image_url: s.profile_image_url,
          cover_image_url: s.cover_image_url ?? null,
          rating: s.rating,
          total_reviews: s.total_reviews,
          is_featured: s.is_featured,
          categories: s.categories || [],
          primary_group: s.primary_group,
          distance_km: s.distance_km,
          society_name: s.society_name,
          is_available: s.is_available ?? true,
          availability_start: s.availability_start ?? null,
          availability_end: s.availability_end ?? null,
          operating_days: s.operating_days ?? null,
          avg_response_minutes: s.avg_response_minutes ?? null,
          last_active_at: s.last_active_at ?? null,
          completed_order_count: s.completed_order_count ?? 0,
          // Category-scoped products so SellerCard can show starting-from price
          products: categoryProducts.map((p: any) => ({ price: p.price })),
        });
      }
    }
    return Array.from(sellerMap.values())
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 10);
  }, [marketplaceSellers, category, queryClient, categoryConfigs]);

  const displayProducts = useMemo(() => {
    let filtered = scopedProducts;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
      );
    }

    filtered = filtered.filter((p) => productMatchesCommerceFacets(p, facets, categoryConfigs));

    const sorted = [...filtered];
    switch (sortBy) {
      case 'price_low': sorted.sort((a, b) => a.price - b.price); break;
      case 'price_high': sorted.sort((a, b) => b.price - a.price); break;
      case 'popular': sorted.sort((a, b) => (b.is_bestseller ? 1 : 0) - (a.is_bestseller ? 1 : 0)); break;
      case 'nearest': sorted.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999)); break;
      case 'newest': sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      case 'rating': sorted.sort((a, b) => (b.seller_rating ?? 0) - (a.seller_rating ?? 0)); break;
    }
    if (!shouldDiversifySort(sortBy)) return sorted;
    return diversifyRankedProducts(sorted, {
      sellerId: (product) => product.seller_id,
      base: (product, index) => {
        const distance = product.distance_km == null ? 8 : Number(product.distance_km);
        return Math.max(0, 40 - distance * 4) - index * 0.001;
      },
      createdAt: (product) => product.created_at,
    });
  }, [scopedProducts, searchQuery, sortBy, facets, categoryConfigs]);

  const handleFacetChange = (nextFacets: CommerceFacetState) => {
    setFacetExtras(nextFacets);
    const next = writeFoodFacetsToSearchParams(new URLSearchParams(searchParams), {
      cuisine: nextFacets.cuisine || null,
      meal: nextFacets.meal || null,
      course: nextFacets.course || null,
    });
    if (activeSubCategory && (nextFacets.cuisine || nextFacets.meal || nextFacets.course)) {
      const group = browseGroups.find((item) => item.category === activeSubCategory);
      const still = group?.products.some((product) => productMatchesFoodFacets(product, {
        cuisine: nextFacets.cuisine || null,
        meal: nextFacets.meal || null,
        course: nextFacets.course || null,
      }));
      if (!still) next.delete('sub');
    }
    setSearchParams(next, { replace: true });
  };

  const selectBrowseIntent = (intent: { id: string; kind: 'category' | 'food_mood' }) => {
    const next = new URLSearchParams(searchParams);
    if (intent.kind === 'category') {
      const slug = intent.id.replace(/^cat:/, '');
      if (activeSubCategory === slug) next.delete('sub');
      else next.set('sub', slug);
      setSearchParams(next, { replace: true });
      return;
    }
    const mood = TASTE_MOODS.find((item) => intent.id === `mood:${item.id}`);
    if (!mood) return;
    const turningOff = facets[mood.facet] === mood.value;
    const food = {
      cuisine: facets.cuisine || null,
      meal: facets.meal || null,
      course: facets.course || null,
      [mood.facet]: turningOff ? null : mood.value,
    };
    const written = writeFoodFacetsToSearchParams(next, food);
    if (!turningOff && activeSubCategory) {
      const group = browseGroups.find((item) => item.category === activeSubCategory);
      const still = group?.products.some((product) => productMatchesFoodFacets(product, food));
      if (!still) written.delete('sub');
    }
    setSearchParams(written, { replace: true });
  };

  const isLoading = groupsLoading || configsLoading;

  if (isLoading) {
    return (
      <AppLayout showHeader={false}>
        <div className="p-4">
          <Skeleton className="h-10 w-full rounded-xl mb-4" />
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const openLeaf = routeLeaf
    ? categoryConfigs.find((config) => config.category === routeLeaf)
    : null;
  const pageTitle = openLeaf?.displayName
    || (routeLeaf
      ? routeLeaf.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
      : parentGroup?.label)
    || 'Category';

  if (!parentGroup && !routeLeaf && !groupsLoading && !configsLoading) {
    return (
      <AppLayout showHeader={false}>
        <div className="p-4 text-center">
          <p>Category not found</p>
          <Link to="/">
            <Button className="mt-4">Go Home</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (!parentGroup && !routeLeaf) return null;

  return (
    <AppLayout showHeader={false} safeTop={false}>
      {/* Sticky Header */}
      <SafeHeader bordered={false} blur>
        <div className="px-4 pt-1 pb-2">
          <div className="flex items-center gap-2.5 mb-2.5">
            <BackButton fallback="/" />
            <h1 className="text-base font-bold flex items-center gap-2 flex-1 min-w-0">
              {parentGroup && (parentGroup.imageUrl || (parentGroup as any).image_url) ? (
                <span className="w-6 h-6 rounded-lg overflow-hidden shrink-0 inline-flex items-center justify-center border border-border/30">
                  <img src={parentGroup.imageUrl || (parentGroup as any).image_url} alt="" className="w-full h-full object-cover" />
                </span>
              ) : (
                <DynamicIcon name={parentGroup?.icon || 'Package'} size={18} />
              )}
              <span className="truncate">{pageTitle}</span>
            </h1>
          </div>

          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={`Search in ${pageTitle}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 bg-card/55 backdrop-blur-md border border-border/40 rounded-xl text-sm focus-visible:ring-1"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X size={14} />
              </button>
            )}
            <SearchAutocomplete
              query={searchQuery}
              onSelect={(product) => {
                setSelectedProduct(product);
                setDetailOpen(true);
                setSearchQuery('');
              }}
            />
          </div>

          {browseIntents.length > 0 && (
            <DiscoveryChipRail
              intents={browseIntents}
              showTitle={false}
              selectedIds={selectedBrowseIds}
              onSelect={selectBrowseIntent}
              className="px-0 pb-1"
            />
          )}
        </div>

        <div className="border-t border-border/40">
          <CommerceFacetRail
            value={facets}
            onChange={handleFacetChange}
            chips={dynamicFacetChips}
            parentGroup={category}
            inventory={scopedProducts}
          />
        </div>
      </SafeHeader>

      {/* Product Grid */}
      <div className="p-4 pb-6">
        {productsLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
        ) : displayProducts.length > 0 ? (
          <>
            <p className="text-[11px] text-muted-foreground mb-3 px-0.5">
              {`${displayProducts.length} ${displayProducts.length === 1 ? 'item' : 'items'}`}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3.5">
              {displayProducts.map((product) => (
                <ProductListingCard
                  key={product.id}
                  product={product}
                  onTap={handleProductTap}
                  onNavigate={navigate}
                  categoryConfigs={categoryConfigs as any}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16">
            <div className="mb-4 flex justify-center">
              {parentGroup && (parentGroup.imageUrl || (parentGroup as any).image_url) ? (
                <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm border border-border/40">
                  <img src={parentGroup.imageUrl || (parentGroup as any).image_url} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <DynamicIcon name={parentGroup?.icon || 'Package'} size={40} className="text-muted-foreground" />
              )}
            </div>
            <h3 className="font-semibold text-sm mb-2">No items found</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery ? 'Try a different search' : 'Check back soon for new listings!'}
            </p>
            {!searchQuery && (
              <Link to="/">
                <Button variant="outline" size="sm">Browse other categories</Button>
              </Link>
            )}
          </div>
        )}

        {topSellers.length > 0 && !searchQuery && (
          <section className={cn(
            'pt-6 border-t border-border/40',
            displayProducts.length > 0 || productsLoading ? 'mt-10' : 'mt-6'
          )}>
            <div className="flex items-center gap-2 mb-4 px-0.5">
              <span className="text-base" aria-hidden>⭐</span>
              <h3 className="font-extrabold text-sm tracking-tight text-foreground">
                Top Sellers in {parentGroup?.label || ''}
              </h3>
            </div>
            {/* marketplace-stack uses gap - space-y margins do not apply to inline <a>/Link roots */}
            <div className="marketplace-stack">
              {topSellers.slice(0, 5).map((seller: any) => (
                <SellerCard key={seller.id} seller={seller} />
              ))}
            </div>
          </section>
        )}
      </div>

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
            is_veg: sp.is_veg,
            category: sp.category,
            description: sp.description || null,
            seller_id: sp.seller_id,
            seller_name: sp.seller?.business_name || '',
            seller_profile_image_url: sp.seller?.profile_image_url || (sp as any).seller_profile_image_url || null,
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
    </AppLayout>
  );
}
