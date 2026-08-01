// @ts-nocheck
import { useMemo, useState } from 'react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { TypewriterPlaceholder } from '@/components/search/TypewriterPlaceholder';
import { useCurrency } from '@/hooks/useCurrency';
import { useSearchPage, ProductSearchResult } from '@/hooks/useSearchPage';
import { ProductDetailSheet } from '@/components/product/ProductDetailSheet';
import { CommunitySuggestions } from '@/components/search/CommunitySuggestions';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { type ProductDetail } from '@/hooks/useProductDetail';

function toProductWithSeller(p: ProductSearchResult): ProductWithSeller {
  return {
    id: p.product_id, seller_id: p.seller_id, name: p.product_name, price: p.price,
    image_url: p.image_url, is_veg: p.is_veg ?? true, is_available: true,
    is_bestseller: (p as any).is_bestseller ?? false,
    is_recommended: (p as any).is_recommended ?? false,
    is_urgent: (p as any).is_urgent ?? false,
    category: p.category || '', description: p.description || null,
    mrp: p.mrp || null, discount_percentage: p.discount_percentage || null,
    distance_km: p.distance_km || null, society_name: p.society_name || null,
    is_same_society: p.is_same_society, created_at: '', updated_at: '',
    seller_name: p.seller_name, seller_rating: p.seller_rating,
    fulfillment_mode: p.fulfillment_mode || null, delivery_note: p.delivery_note || null,
    action_type: p.action_type || null, contact_phone: p.contact_phone || null,
  } as ProductWithSeller;
}

export default function SearchPage() {
  const s = useSearchPage();
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
    <AppLayout showHeader={false}>
      <div className="pb-24">
        {/* Sticky search header */}
        <SafeHeader zIndex="z-40" bordered={false} className="overflow-visible">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <button onClick={() => s.navigate('/')} className="shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center"><ArrowLeft size={18} className="text-foreground" /></button>
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                {!s.query && <div className="absolute left-9 top-1/2 -translate-y-1/2 pointer-events-none pr-16 overflow-hidden whitespace-nowrap max-w-[calc(100%-4rem)]"><TypewriterPlaceholder context="search" /></div>}
                <Input placeholder="" value={s.query} onChange={(e) => s.setQuery(e.target.value)} className="pl-9 pr-16 h-10 rounded-xl text-sm bg-muted border-0 focus-visible:ring-1" ref={(el) => { if (el) setTimeout(() => el.focus(), 300); }} />
                {s.query && <button onClick={() => s.setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
                <SearchAutocomplete query={s.query} onSelect={(p) => { s.setQuery(''); setSelectedProduct(p); setDetailOpen(true); }} />
              </div>
            </div>
          </div>
          {/* Filter bar */}
          <div className="px-4 pb-2">
            <ScrollArea>
              <div className="flex items-center gap-2 pb-1">
                <SearchFilters
                  filters={s.filters}
                  onFiltersChange={s.handleFiltersChange}
                  showPriceFilter
                  browseBeyond={s.browseBeyond}
                  onBrowseBeyondChange={s.setBrowseBeyond}
                  searchRadius={s.searchRadius}
                  onSearchRadiusChange={s.setSearchRadiusLocal}
                  onSearchRadiusCommit={s.setSearchRadius}
                />
                <button onClick={() => s.setFilters({ ...s.filters, isVeg: s.filters.isVeg === true ? null : true })} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.isVeg === true ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-background text-foreground'}`}>
                  <div className="w-3 h-3 border-[1.5px] border-accent rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-accent" /></div>Veg
                </button>
                <button onClick={() => s.setFilters({ ...s.filters, isVeg: s.filters.isVeg === false ? null : false })} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.isVeg === false ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border bg-background text-foreground'}`}>
                  <div className="w-3 h-3 border-[1.5px] border-destructive rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-destructive" /></div>Non-veg
                </button>
                {([{ value: 'rating' as const, label: 'Top Rated' }, { value: 'price_low' as const, label: 'Price ↑' }, { value: 'price_high' as const, label: 'Price ↓' }, { value: 'nearest' as const, label: 'Nearest' }]).map(({ value, label }) => (
                  <button key={value} onClick={() => s.setFilters({ ...s.filters, sortBy: s.filters.sortBy === value ? null : value })} className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${s.filters.sortBy === value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-foreground'}`}>{label}</button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        </SafeHeader>

        <div className="px-4">
          {/* Community search suggestions */}
          {!s.isSearchActive && (
            <CommunitySuggestions onSuggestionTap={(term) => s.setQuery(term)} />
          )}

          {/* Category Bubbles */}
          <CategoryBubbleRow categories={s.categoryConfigs.filter(c => s.popularProducts.some(p => p.category === c.category))} selectedCategory={s.selectedCategory} onCategoryTap={s.handleCategoryTap} isLoading={s.categoriesLoading || s.isLoadingPopular} />

          {/* Filter presets */}
          <FilterPresets activePreset={s.activePreset} onPresetSelect={s.handlePresetSelect} />

          {/* Active filter pills */}
          {s.pills.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
              {s.pills.map((label, i) => <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium whitespace-nowrap">{label}</span>)}
              <button onClick={s.clearFilters} className="text-[11px] text-muted-foreground underline whitespace-nowrap ml-1">Clear</button>
            </div>
          )}

          {/* Results */}
          {s.showLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 mt-2">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
            </div>
          ) : s.displayProducts.length > 0 ? (
            <ProductGridByCategory products={s.displayProducts} categoryMap={s.categoryMap} categoryConfigs={s.categoryConfigs} marketplaceConfig={s.mc} badgeConfigs={s.badgeConfigs} showCount={s.isSearchActive} onNavigate={s.navigate} onProductTap={handleProductTap} />
          ) : s.isSearchActive ? (
            <EmptyState browseBeyond={s.browseBeyond} onEnableBrowseBeyond={() => s.setBrowseBeyond(true)} />
          ) : (
            <EmptyMarketplace />
          )}
        </div>
      </div>

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
              is_veg: sp.is_veg ?? true,
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
    </AppLayout>
  );
}

// ── Category Bubble Row ──
function CategoryBubbleRow({ categories, selectedCategory, onCategoryTap, isLoading }: {
  categories: { category: string; displayName: string; icon: string; color: string }[];
  selectedCategory: string | null;
  onCategoryTap: (cat: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) return <div className="flex gap-2 mb-3 overflow-hidden">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 w-16 rounded-2xl shrink-0" />)}</div>;
  return (
    <ScrollArea className="mb-3">
      <div className="flex gap-2 pb-2">
        {categories.map((cat) => (
          <button key={cat.category} onClick={() => onCategoryTap(cat.category)} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-2xl min-w-[68px] transition-all shrink-0 ${selectedCategory === cat.category ? 'bg-primary text-primary-foreground shadow-md scale-[1.03]' : 'bg-muted/60 hover:bg-muted'}`}>
            <span className="text-xl leading-none"><DynamicIcon name={cat.icon} size={20} /></span>
            <span className={`text-[10px] font-medium leading-tight text-center line-clamp-1 ${selectedCategory === cat.category ? 'text-primary-foreground' : 'text-foreground'}`}>{cat.displayName}</span>
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

// ── Product Grid By Category ──
function ProductGridByCategory({ products, categoryMap, categoryConfigs, marketplaceConfig, badgeConfigs, showCount, onNavigate, onProductTap }: {
  products: ProductSearchResult[];
  categoryMap: Record<string, { icon: string; displayName: string; color: string }>;
  categoryConfigs: { category: string; displayName: string; icon: string; behavior?: any }[];
  marketplaceConfig?: MarketplaceConfig;
  badgeConfigs?: BadgeConfigRow[];
  showCount?: boolean;
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
      {showCount && <p className="text-xs text-muted-foreground">{products.length} item{products.length !== 1 ? 's' : ''} found</p>}
      {Object.keys(grouped).map((cat) => {
        const items = grouped[cat];
        const catInfo = categoryMap[cat];
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base leading-none"><DynamicIcon name={catInfo?.icon || 'Package'} size={18} /></span>
              <h3 className="font-bold text-sm text-foreground">{catInfo?.displayName || cat}</h3>
              <span className="text-xs text-muted-foreground">({items.length})</span>
              <span className="text-[11px] font-semibold text-accent ml-auto">From {formatPrice(Math.min(...items.map(p => p.price)))}</span>
            </div>
            <motion.div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5"
              variants={staggerGrid}
              initial="hidden"
              animate="show"
              key={cat}
            >
              {items.map((p) => (
                <motion.div key={p.product_id} variants={cardEntrance}>
                  <ProductListingCard product={toProductWithSeller(p)} categoryConfigs={categoryConfigs as any} marketplaceConfig={marketplaceConfig} badgeConfigs={badgeConfigs} onNavigate={onNavigate} onTap={onProductTap} />
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
        description="Some services may not be available in your community yet."
      >
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Try browsing by category, or <Link to="/become-seller" className="text-primary font-semibold hover:underline">become the first to offer this service</Link>.</p>
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
