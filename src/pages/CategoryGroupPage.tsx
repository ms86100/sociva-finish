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
import {
  CommerceFacetState,
  emptyCommerceFacetState,
  hasActiveCommerceFacets,
  productMatchesCommerceFacets,
  extractAvailableCommerceFacets,
} from '@/lib/commerce-facets';
import {
  isFoodParentGroup,
  readFoodFacetsFromSearchParams,
  writeFoodFacetsToSearchParams,
  type FoodFacets,
} from '@/lib/food-facets';

export default function CategoryGroupPage() {
  const { category } = useParams<{ category: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const subCategory = searchParams.get('sub') as ServiceCategory | null;

  
  const { groupedConfigs, configs, isLoading: configsLoading } = useCategoryConfigs();
  const { getGroupBySlug, isLoading: groupsLoading } = useParentGroups();
  const [activeSubCategory, setActiveSubCategory] = useState<ServiceCategory | null>(subCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('relevance');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterOpenNow, setFilterOpenNow] = useState(false);
  const [filterVeg, setFilterVeg] = useState(false);
  const { configs: categoryConfigs } = useCategoryConfigs();

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
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      action_type: product.action_type,
      contact_phone: product.contact_phone,
      prep_time_minutes: product.prep_time_minutes,
      fulfillment_mode: product.fulfillment_mode,
      delivery_note: product.delivery_note,
      _catIcon: catConfig?.icon || '🛍️',
      _catName: catConfig?.displayName || product.category,
    });
    setDetailOpen(true);
  }, [categoryConfigs]);

  const parentGroup = category ? getGroupBySlug(category) : undefined;
  const allSubCategories = category ? groupedConfigs[category] || [] : [];

  const { data: allProducts = [], isLoading: productsLoading } = useCategoryProducts(
    category || null,
  );

  const [facets, setFacets] = useState<CommerceFacetState>(emptyCommerceFacetState());

  const scopedProducts = useMemo(() => {
    return activeSubCategory
      ? productsWithFacets.filter((p) => p.category === activeSubCategory)
      : productsWithFacets;
  }, [productsWithFacets, activeSubCategory]);

  const dynamicFacetChips = useMemo(() => {
    return extractAvailableCommerceFacets(scopedProducts, {
      parentGroup: category,
      currentState: facets,
    });
  }, [scopedProducts, category, facets]);

  const activeCategorySet = useMemo(
    () => new Set(allProducts.map((p) => p.category)),
    [allProducts]
  );
  const subCategories = useMemo(
    () => allSubCategories.filter((c) => activeCategorySet.has(c.category) || c.category === activeSubCategory),
    [allSubCategories, activeCategorySet, activeSubCategory]
  );
  const showAllTab = subCategories.length > 1;

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
  }, [marketplaceSellers, category, queryClient]);

  const displayProducts = useMemo(() => {
    let filtered = scopedProducts;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
      );
    }

    filtered = filtered.filter((p) => productMatchesCommerceFacets(p, facets));

    const sorted = [...filtered];
    switch (sortBy) {
      case 'price_low': sorted.sort((a, b) => a.price - b.price); break;
      case 'price_high': sorted.sort((a, b) => b.price - a.price); break;
      case 'popular': sorted.sort((a, b) => (b.is_bestseller ? 1 : 0) - (a.is_bestseller ? 1 : 0)); break;
      case 'nearest': sorted.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999)); break;
      case 'newest': sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      case 'rating': sorted.sort((a, b) => (b.seller_rating ?? 0) - (a.seller_rating ?? 0)); break;
    }
    return sorted;
  }, [scopedProducts, searchQuery, sortBy, facets]);

  const handleSubCategorySelect = (cat: ServiceCategory | null) => {
    setActiveSubCategory(cat);
    const next = new URLSearchParams(searchParams);
    if (cat) next.set('sub', cat);
    else next.delete('sub');
    setSearchParams(next, { replace: true });
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!parentGroup && !groupsLoading) {
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

  if (!parentGroup) return null;

  return (
    <AppLayout showHeader={false} safeTop={false}>
      {/* Sticky Header */}
      <SafeHeader bordered={false}>
        <div className="px-4 pt-1 pb-2">
          <div className="flex items-center gap-2.5 mb-2.5">
            <BackButton fallback="/" />
            <h1 className="text-base font-bold flex items-center gap-1.5 flex-1 min-w-0">
              <DynamicIcon name={parentGroup.icon} size={18} />
              <span className="truncate">{parentGroup.label}</span>
            </h1>
          </div>

          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={`Search in ${parentGroup.label}…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 bg-muted border-0 rounded-xl text-sm focus-visible:ring-1"
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

          {subCategories.length > 0 && (
            <div className="taste-rail-scroll pb-1">
              <div className="flex gap-1.5">
                {showAllTab && (
                  <button
                    onClick={() => handleSubCategorySelect(null)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors',
                      !activeSubCategory
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-background text-foreground border-border'
                    )}
                  >
                    All
                  </button>
                )}
                {subCategories.map((config) => (
                  <button
                    key={config.category}
                    onClick={() => handleSubCategorySelect(config.category)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors flex items-center gap-1',
                      activeSubCategory === config.category
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-background text-foreground border-border'
                    )}
                  >
                    <DynamicIcon name={config.icon} size={12} />
                    {config.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border/40">
          <CommerceFacetRail
            value={facets}
            onChange={setFacets}
            chips={dynamicFacetChips}
            parentGroup={category}
          />
        </div>
      </SafeHeader>

      {/* Product Grid */}
      <div className="p-4 pb-6">
        {productsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-3.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
        ) : displayProducts.length > 0 ? (
          <>
            <p className="text-[11px] text-muted-foreground mb-3 px-0.5">
              {displayProducts.length} item{displayProducts.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-3.5">
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
              <DynamicIcon name={parentGroup.icon} size={40} className="text-muted-foreground" />
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
                Top Sellers in {parentGroup.label}
              </h3>
            </div>
            {/* marketplace-stack uses gap — space-y margins do not apply to inline <a>/Link roots */}
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
    </AppLayout>
  );
}
