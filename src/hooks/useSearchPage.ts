// @ts-nocheck
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useCart } from '@/hooks/useCart';
import { FilterState, defaultFilters } from '@/components/search/SearchFilters';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { useBadgeConfig } from '@/hooks/useBadgeConfig';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';
import { useCurrency } from '@/hooks/useCurrency';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import { committedSearchKey, getSessionQueryId } from '@/lib/searchTelemetry';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';
import { useRegisterScreenRefresh } from '@/hooks/usePullToRefresh';

export interface ProductSearchResult {
  product_id: string;
  product_name: string;
  price: number;
  image_url: string | null;
  is_veg: boolean | null;
  category: string | null;
  description?: string | null;
  prep_time_minutes?: number | null;
  fulfillment_mode?: string | null;
  delivery_note?: string | null;
  action_type?: string | null;
  contact_phone?: string | null;
  mrp?: number | null;
  discount_percentage?: number | null;
  tags?: string[] | null;
  cuisine_type?: string | null;
  seller_id: string;
  seller_name: string;
  seller_rating: number;
  seller_reviews: number;
  society_name: string | null;
  distance_km: number | null;
  is_same_society: boolean;
}

const FILTER_STORAGE_KEY_BASE = 'app_search_filters';
const getFilterStorageKey = (userId?: string) => userId ? `${FILTER_STORAGE_KEY_BASE}_${userId}` : FILTER_STORAGE_KEY_BASE;

const loadSavedFilters = (_userId?: string): FilterState => {
  // Always start with clean defaults — don't persist filters across sessions
  return defaultFilters;
};

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = useState<T>(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

/** Map a seller row from search_sellers_by_location RPC into ProductSearchResult[] */
function mapSellerRpcProducts(seller: any): ProductSearchResult[] {
  const products: ProductSearchResult[] = [];
  (seller.matching_products || []).forEach((p: any) => {
    products.push({
      product_id: p.id, product_name: p.name, price: p.price, image_url: p.image_url,
      is_veg: p.is_veg, category: p.category, description: null, prep_time_minutes: null,
      fulfillment_mode: null, delivery_note: null, action_type: p.action_type || 'add_to_cart',
      contact_phone: p.contact_phone || null, mrp: p.mrp || null, discount_percentage: p.discount_percentage || null,
      tags: p.tags || null, cuisine_type: p.cuisine_type || null,
      seller_id: seller.seller_id, seller_name: seller.business_name || '', seller_rating: seller.rating || 0,
      seller_reviews: seller.total_reviews || 0, society_name: seller.society_name || null,
      distance_km: seller.distance_km || null, is_same_society: (seller.distance_km ?? 99) < 0.5,
    });
  });
  return products;
}

function mapSearchRpcProduct(p: any): ProductSearchResult {
  return {
    product_id: p.product_id, product_name: p.product_name, price: p.price,
    image_url: p.image_url, is_veg: p.is_veg, category: p.category,
    description: p.description, prep_time_minutes: null, fulfillment_mode: null,
    delivery_note: null, action_type: p.action_type || 'add_to_cart',
    contact_phone: null, mrp: p.mrp || null, discount_percentage: p.discount_percentage || null,
    tags: p.tags || null, cuisine_type: p.cuisine_type || null,
    seller_id: p.seller_id, seller_name: p.seller_name || '',
    seller_rating: p.seller_rating || 0, seller_reviews: p.seller_total_reviews || 0,
    society_name: p.society_name || null, distance_km: p.distance_km ?? null,
    is_same_society: p.is_same_society ?? ((p.distance_km ?? 99) < 0.5),
  };
}

export function useSearchPage() {
  const { user, effectiveSocietyId, profile } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const navigate = useNavigate();
  const { items: cartItems, addItem, updateQuantity } = useCart();
  const [searchParams, setSearchParams] = useSearchParams();
  const { configs: categoryConfigs, isLoading: categoriesLoading } = useCategoryConfigs();
  const mc = useMarketplaceConfig();
  const { badges: badgeConfigs } = useBadgeConfig();
  const settings = useSystemSettings();
  const { formatPrice, currencySymbol } = useCurrency();

  const lat = browsingLocation?.lat;
  const lng = browsingLocation?.lng;
  const hasCoords = hasPreciseCoordinates(lat, lng);
  const needsPreciseLocation = !hasCoords;

  const categoryMap = useMemo(() => {
    const m: Record<string, { icon: string; displayName: string; color: string; supportsCart?: boolean; enquiryOnly?: boolean; requiresTimeSlot?: boolean }> = {};
    categoryConfigs.forEach((c) => {
      m[c.category] = { icon: c.icon, displayName: c.displayName, color: c.color, supportsCart: c.behavior?.supportsCart ?? false, enquiryOnly: c.behavior?.enquiryOnly ?? false, requiresTimeSlot: c.behavior?.requiresTimeSlot ?? false };
    });
    return m;
  }, [categoryConfigs]);

  const [query, setQuery] = useState(() => searchParams.get('q')?.trim() || '');
  const debouncedQuery = useDebounce(query, 300);
  const [filters, setFilters] = useState<FilterState>(() => loadSavedFilters(user?.id));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Hydrate from back/forward navigation, then keep shareable search URLs current.
  useEffect(() => {
    const urlQuery = searchParams.get('q')?.trim() || '';
    setQuery((current) => current === urlQuery ? current : urlQuery);
  }, [searchParams]);

  useEffect(() => {
    const currentUrlQuery = searchParams.get('q') || '';
    if (currentUrlQuery === query) return;
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set('q', query);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [query, searchParams, setSearchParams]);

  const [browseBeyond, setBrowseBeyondLocal] = useState(profile?.browse_beyond_community ?? true);
  const [searchRadius, setSearchRadiusLocal] = useState(profile?.search_radius_km ?? MARKETPLACE_RADIUS_KM);

  useEffect(() => { if (profile) { setBrowseBeyondLocal(profile.browse_beyond_community ?? true); setSearchRadiusLocal(profile.search_radius_km ?? MARKETPLACE_RADIUS_KM); } }, [profile]);

  const persistPreference = useCallback(async (field: string, value: any) => { if (!user) return; await supabase.from('profiles').update({ [field]: value } as any).eq('id', user.id); }, [user]);
  const setBrowseBeyond = useCallback((val: boolean) => { setBrowseBeyondLocal(val); persistPreference('browse_beyond_community', val); }, [persistPreference]);
  const setSearchRadius = useCallback((val: number) => { setSearchRadiusLocal(val); persistPreference('search_radius_km', val); }, [persistPreference]);

  // Popular products — derived from shared marketplace cache (zero additional RPC)
  const { data: marketplaceSellers, isLoading: isLoadingPopular } = useMarketplaceData();
  const popularProducts = useMemo((): ProductSearchResult[] => {
    if (!marketplaceSellers || marketplaceSellers.length === 0) return [];
    const mapped: ProductSearchResult[] = [];
    const seen = new Set<string>();
    for (const seller of marketplaceSellers) {
      for (const p of mapSellerRpcProducts(seller)) {
        if (!seen.has(p.product_id)) {
          seen.add(p.product_id);
          mapped.push(p);
        }
      }
    }
    return mapped;
  }, [marketplaceSellers]);

  useEffect(() => { const sort = searchParams.get('sort'); if (sort === 'rating') handlePresetSelect('top_rated', { minRating: 4, sortBy: 'rating' }); }, []);

  const hasActiveFilters = () => filters.minRating > 0 || filters.isVeg !== null || filters.categories.length > 0 || filters.sortBy !== null || filters.priceRange[0] > 0 || filters.priceRange[1] < settings.maxPriceFilter;
  const isSearchActive = debouncedQuery.length >= 2 || hasActiveFilters() || selectedCategory !== null;
  const filtersKey = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);
  const telemetryIdsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (isSearchActive) { runSearch(debouncedQuery); }
    else { setResults([]); setHasSearched(false); }
  }, [debouncedQuery, filtersKey, browseBeyond, searchRadius, selectedCategory]);

  useEffect(() => { return () => { abortRef.current?.abort(); }; }, []);

  const runSearch = async (term: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); setHasSearched(true);

    try {
      if (!hasCoords) {
        setResults([]);
        return;
      }
      const products: ProductSearchResult[] = [];
      const effectiveCategories = selectedCategory ? [selectedCategory, ...filters.categories.filter(c => c !== selectedCategory)] : filters.categories;
      const radius = browseBeyond ? searchRadius : 2;
      const normalizedTerm = term.trim();
      const startedAt = performance.now();
      let retrievalMode = 'v2:browse';
      let usedVersionedSearch = false;

      {
        // Primary: versioned search applies every eligibility/filter predicate before LIMIT.
        // Location is optional so text/category/filter discovery still works before geolocation resolves.
        const { data: v2Data, error: v2Error } = await supabase.rpc('search_products_v2' as any, {
          _query: normalizedTerm,
          _lat: lat ?? null, _lng: lng ?? null, _radius_km: radius,
          _buyer_society_id: effectiveSocietyId || null,
          _categories: effectiveCategories.length ? effectiveCategories : null,
          _min_rating: filters.minRating || 0,
          _is_veg: filters.isVeg,
          _min_price: filters.priceRange[0] > 0 ? filters.priceRange[0] : null,
          _max_price: filters.priceRange[1] < settings.maxPriceFilter ? filters.priceRange[1] : null,
          _sort_by: filters.sortBy,
          _limit: 50,
          _offset: 0,
        });

        if (!v2Error && v2Data) {
          usedVersionedSearch = true;
          const existingIds = new Set<string>();
          (v2Data as any[]).forEach((p: any) => {
            if (!existingIds.has(p.product_id)) {
              existingIds.add(p.product_id);
              products.push(mapSearchRpcProduct(p));
            }
          });
          const modes = new Set((v2Data as any[]).map((p: any) => p.retrieval_mode).filter(Boolean));
          retrievalMode = `v2:${['exact', 'phrase', 'fts', 'browse'].find(mode => modes.has(mode)) || (normalizedTerm ? 'fts' : 'browse')}`;
        } else {
          // Immediate compatibility fallback while the additive migration rolls out.
          const { data: legacyData, error: legacyError } = await supabase.rpc('search_products_fts' as any, {
            _query: normalizedTerm,
            _lat: lat ?? null, _lng: lng ?? null, _radius_km: radius,
            _category: selectedCategory || (effectiveCategories.length === 1 ? effectiveCategories[0] : null),
            _limit: 50,
            _offset: 0,
          });
          if (legacyError) throw legacyError;
          retrievalMode = 'legacy:fts';
          const existingIds = new Set<string>();
          (legacyData as any[] || []).forEach((p: any) => {
            if (!existingIds.has(p.product_id)) {
              existingIds.add(p.product_id);
              products.push(mapSearchRpcProduct(p));
            }
          });
        }
      }

      // Apply client-side filters
      let filtered = products;
      if (filters.minRating > 0) filtered = filtered.filter((p) => p.seller_rating >= filters.minRating);
      if (filters.isVeg === true) filtered = filtered.filter((p) => p.is_veg === true);
      if (filters.isVeg === false) filtered = filtered.filter((p) => p.is_veg === false);
      if (effectiveCategories.length > 0 && term.length >= 2) filtered = filtered.filter((p) => p.category && effectiveCategories.includes(p.category as any));
      if (filters.priceRange[0] > 0 || filters.priceRange[1] < settings.maxPriceFilter) filtered = filtered.filter((p) => p.price >= filters.priceRange[0] && p.price <= filters.priceRange[1]);

      if (filters.sortBy === 'price_low') filtered.sort((a, b) => a.price - b.price);
      else if (filters.sortBy === 'price_high') filtered.sort((a, b) => b.price - a.price);
      else if (filters.sortBy === 'rating') filtered.sort((a, b) => b.seller_rating - a.seller_rating);
      else if (filters.sortBy === 'nearest') filtered.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
      else if (filters.sortBy === 'newest') { /* Keep the versioned RPC's created_at order. */ }
      else if (!usedVersionedSearch) filtered.sort((a, b) => { if (a.is_same_society !== b.is_same_society) return a.is_same_society ? -1 : 1; return (a.distance_km ?? 0) - (b.distance_km ?? 0); });

      if (!controller.signal.aborted) {
        setResults(filtered);

        // A committed search is a completed retrieval, never an input keystroke.
        if (normalizedTerm.length >= 2) {
          const telemetryFilters = {
            categories: effectiveCategories,
            minRating: filters.minRating,
            isVeg: filters.isVeg,
            priceRange: filters.priceRange,
            sortBy: filters.sortBy,
            browseBeyond,
            radiusKm: radius,
          };
          const telemetryKey = committedSearchKey(normalizedTerm, telemetryFilters);
          const sessionQueryId = getSessionQueryId(telemetryIdsRef.current, telemetryKey);
          supabase.rpc('log_committed_search' as any, {
            _session_query_id: sessionQueryId,
            _search_term: normalizedTerm,
            _society_id: effectiveSocietyId || null,
            _category: selectedCategory || null,
            _result_count: filtered.length,
            _filters: telemetryFilters,
            _retrieval_mode: retrievalMode,
            _latency_ms: Math.round(performance.now() - startedAt),
          }).then(({ error: logErr }) => {
            if (logErr) console.warn('Committed search telemetry failed:', logErr.message);
          });
        }
      }
    } catch (err) { if (!controller.signal.aborted) console.error('Search error:', err); }
    finally { if (!controller.signal.aborted) setIsLoading(false); }
  };

  useRegisterScreenRefresh(async () => {
    if (isSearchActive) await runSearch(debouncedQuery);
  });

  const clearFilters = () => { setQuery(''); setFilters(defaultFilters); setActivePreset(null); setSelectedCategory(null); setResults([]); setHasSearched(false); localStorage.removeItem(getFilterStorageKey(user?.id)); };
  const handleFiltersChange = (f: FilterState) => { setFilters(f); setActivePreset(null); };
  const handlePresetSelect = (id: string | null, pf: Partial<FilterState>) => { setActivePreset(id); setFilters(id ? { ...defaultFilters, ...pf } : defaultFilters); };
  const handleCategoryTap = (cat: string) => { setSelectedCategory(prev => prev === cat ? null : cat); };

  const pills: string[] = [];
  if (query) pills.push(`"${query}"`);
  if (selectedCategory) pills.push(categoryMap[selectedCategory]?.displayName || selectedCategory);
  if (filters.minRating > 0) pills.push(`${filters.minRating}+★`);
  if (filters.isVeg === true) pills.push('Veg');
  if (filters.isVeg === false) pills.push('Non-veg');
  if (filters.categories.length) pills.push(...filters.categories.map((c) => categoryMap[c]?.displayName || c));
  if (filters.sortBy) { const labels: Record<string, string> = { rating: 'Top Rated', newest: 'Newest', price_low: `${currencySymbol} Low→High`, price_high: `${currencySymbol} High→Low`, nearest: 'Nearest' }; pills.push(labels[filters.sortBy]); }

  const displayProducts = isSearchActive ? results : popularProducts;
  const showLoading = isSearchActive ? isLoading : isLoadingPopular;

  return {
    navigate, query, setQuery, filters, setFilters,
    activePreset, selectedCategory, isSearchActive,
    browseBeyond, setBrowseBeyond, setBrowseBeyondLocal,
    searchRadius, setSearchRadius, setSearchRadiusLocal,
    categoryConfigs, categoriesLoading, categoryMap,
    mc, badgeConfigs, settings, formatPrice, currencySymbol,
    popularProducts, isLoadingPopular,
    displayProducts, showLoading, hasSearched,
    needsPreciseLocation,
    pills, clearFilters, handleFiltersChange, handlePresetSelect, handleCategoryTap,
  };
}
