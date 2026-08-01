// @ts-nocheck
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Flame, Search, Sparkles, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { SORT_OPTIONS, type SortKey } from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';

export default function DiscoveryListingsPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const ml = useMarketplaceLabels();
  const { browsingLocation } = useBrowsingLocation();
  const { configs: categoryConfigs } = useCategoryConfigs();
  const { data: localCategories = [], isLoading } = useProductsByCategory(120);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('relevance');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const allProducts = useMemo(() => localCategories.flatMap(c => c.products), [localCategories]);
  const newThisWeekDays = ml.threshold('new_this_week_days');
  const discoveryMaxItems = Math.max(ml.threshold('discovery_max_items') || 10, 30);

  const baseProducts = useMemo(() => {
    const popular = [...allProducts]
      .sort((a, b) => ((b as any).completed_order_count || 0) - ((a as any).completed_order_count || 0))
      .slice(0, discoveryMaxItems);

    if (type === 'new') {
      const cutoff = Date.now() - (newThisWeekDays || 7) * 24 * 60 * 60 * 1000;
      const popularIds = new Set(popular.map(p => p.id));
      return allProducts
        .filter(p => new Date(p.created_at).getTime() >= cutoff && !popularIds.has(p.id))
        .slice(0, discoveryMaxItems);
    }

    return popular;
  }, [allProducts, type, newThisWeekDays, discoveryMaxItems]);

  const displayTitle = type === 'new'
    ? ml.label('label_discovery_new')
    : browsingLocation?.label
      ? `${ml.label('label_discovery_popular')} · ${browsingLocation.label}`
      : ml.label('label_discovery_popular');

  const displayIcon = type === 'new'
    ? <Sparkles size={16} className="text-primary" />
    : <Flame size={16} className="text-destructive" />;

  const displayProducts = useMemo(() => {
    let filtered = baseProducts;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.seller_name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
      );
    }

    const sorted = [...filtered];
    switch (sortBy) {
      case 'price_low': sorted.sort((a, b) => a.price - b.price); break;
      case 'price_high': sorted.sort((a, b) => b.price - a.price); break;
      case 'popular': sorted.sort((a, b) => ((b as any).completed_order_count || 0) - ((a as any).completed_order_count || 0)); break;
      case 'nearest': sorted.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999)); break;
      case 'newest': sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      case 'rating': sorted.sort((a, b) => (b.seller_rating ?? 0) - (a.seller_rating ?? 0)); break;
    }
    return sorted;
  }, [baseProducts, searchQuery, sortBy]);

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
      seller_id: product.seller_id,
      seller_name: product.seller_name || '',
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      society_name: (product as any).society_name || null,
      distance_km: (product as any).distance_km ?? null,
      is_same_society: (product as any).is_same_society ?? true,
      last_active_at: (product as any).last_active_at ?? null,
      _catIcon: catConfig?.icon || '🛍️',
      _catName: catConfig?.displayName || product.category,
    });
    setDetailOpen(true);
  }, [categoryConfigs]);

  return (
    <AppLayout showHeader={false}>
      <SafeHeader bordered={false}>
        <div className="px-4 pt-2 pb-2 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate(-1)} className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <ArrowLeft size={18} className="text-foreground" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-foreground flex items-center gap-1.5">
                {displayIcon}
                <span className="truncate">{displayTitle}</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">See all listings in this discovery section</p>
            </div>
          </div>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search listings…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 bg-muted border-0 rounded-xl text-sm focus-visible:ring-1"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="border-t border-border/40">
          <ScrollArea className="px-4 py-2">
            <div className="flex gap-1.5">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSortBy(opt.key)}
                  className={cn(
                    'px-3 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap border transition-colors',
                    sortBy === opt.key
                      ? 'bg-primary/10 text-primary border-primary'
                      : 'bg-background text-muted-foreground border-border'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </SafeHeader>

      <div className="p-4 pb-6">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}
          </div>
        ) : displayProducts.length > 0 ? (
          <>
            <p className="text-[11px] text-muted-foreground mb-3">
              {displayProducts.length} listing{displayProducts.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {displayProducts.map((product) => (
                <ProductListingCard
                  key={product.id}
                  product={product}
                  onTap={handleProductTap}
                  onNavigate={navigate}
                  categoryConfigs={categoryConfigs}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-foreground">No listings found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another search or go back.</p>
          </div>
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
