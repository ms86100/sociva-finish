// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useResolvedCategoryAliases } from '@/hooks/useResolvedCategoryAliases';

import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Package, Tag, Wrench, Calendar, MessageCircle } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useNavigate } from 'react-router-dom';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface Props {
  query: string;
  onSelect: (product: any) => void;
}

interface CategoryMatch {
  slug: string;
  displayName: string;
  icon: string;
  parentGroup: string;
  matchedAlias?: string | null;
}

const INTENT_GROUPS = [
  { key: 'products', label: 'Products', icon: Package },
  { key: 'services', label: 'Services', icon: Wrench },
  { key: 'bookable', label: 'Bookable', icon: Calendar },
  { key: 'enquiries', label: 'Enquiries', icon: MessageCircle },
] as const;

function canonicalIntent(actionType?: string | null) {
  if (actionType === 'request_service') return 'services';
  if (actionType === 'book') return 'bookable';
  if (['request_quote', 'contact_seller', 'schedule_visit', 'make_offer'].includes(actionType || '')) return 'enquiries';
  return 'products';
}

/**
 * Search autocomplete using full-text search (tsvector/tsquery).
 * Replaces former ILIKE pattern matching for dramatically better
 * performance at scale (GIN index vs sequential scan).
 */
export function SearchAutocomplete({ query, onSelect }: Props) {
  const { profile } = useAuth();
  const { formatPrice } = useCurrency();
  const { browsingLocation } = useBrowsingLocation();
  const navigate = useNavigate();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissedQuery, setDismissedQuery] = useState('');
  const { configs: categoryConfigs } = useCategoryConfigs();
  const { index: aliasIndex } = useResolvedCategoryAliases();
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  const lat = browsingLocation?.lat;
  const lng = browsingLocation?.lng;
  const radiusKm = profile?.search_radius_km ?? MARKETPLACE_RADIUS_KM;

  // Match categories by slug, display name, or admin-curated alias
  // (approved/merged category_requests like "makhana" → "snacks").
  const matchedCategories: CategoryMatch[] = useMemo(() => {
    if (lower.length < 2) return [];
    const configBySlug = new Map(categoryConfigs.map(c => [c.category, c]));
    const out: CategoryMatch[] = [];
    const seen = new Set<string>();

    for (const c of categoryConfigs) {
      if (c.category.toLowerCase().includes(lower) || c.displayName.toLowerCase().includes(lower)) {
        if (seen.has(c.category)) continue;
        seen.add(c.category);
        out.push({ slug: c.category, displayName: c.displayName, icon: c.icon, parentGroup: c.parentGroup });
      }
    }

    // Admin-alias matches: exact OR alias contains query OR query contains alias.
    for (const [alias, slug] of Object.entries(aliasIndex.aliasToCategorySlug)) {
      if (seen.has(slug)) continue;
      if (alias === lower || alias.includes(lower) || lower.includes(alias)) {
        const c = configBySlug.get(slug);
        if (!c) continue;
        seen.add(slug);
        out.push({ slug: c.category, displayName: c.displayName, icon: c.icon, parentGroup: c.parentGroup, matchedAlias: alias });
      }
    }

    return out.slice(0, 4);
  }, [lower, categoryConfigs, aliasIndex]);



  // Full-text search for products — uses GIN-indexed tsvector
  // Short queries (< 3 chars) use staleTime to prevent rapid re-fetches
  const { data: productSuggestions = [] } = useQuery({
    queryKey: ['search-fts', trimmed, lat, lng, radiusKm],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('search_products_fts' as any, {
        _query: trimmed,
        _lat: lat ?? null,
        _lng: lng ?? null,
        _radius_km: radiusKm,
        _limit: 8,
        _offset: 0,
      });
      if (signal?.aborted) return [];
      if (error) {
        console.error('FTS search error:', error);
        return [];
      }
      return (data || []) as any[];
    },
    enabled: trimmed.length >= 2,
    staleTime: 2 * 60_000,
  });

  // Seller search (lightweight — no product embedding)
  const { data: sellerSuggestions = [] } = useQuery({
    queryKey: ['search-autocomplete-sellers', trimmed, lat, lng, radiusKm],
    queryFn: async () => {
      if (!lat || !lng) return [];
      const boxDelta = radiusKm * 0.009;
      const { data } = await supabase
        .from('seller_profiles')
        .select('id, business_name, description, profile_image_url, categories')
        .eq('verification_status', 'approved')
        .eq('is_available', true)
        .ilike('business_name', `%${trimmed}%`)
        .gte('latitude', lat - boxDelta)
        .lte('latitude', lat + boxDelta)
        .gte('longitude', lng - boxDelta)
        .lte('longitude', lng + boxDelta)
        .limit(8);
      const { filterDiscoverableSellerIds } = await import('@/lib/sellerDiscoverability');
      const allowed = await filterDiscoverableSellerIds(
        (data || []).map((d: { id: string }) => d.id),
        lat,
        lng,
      );
      return (data || []).filter((d: any) => allowed.has(d.id)).slice(0, 3).map((d: any) => ({
        id: d.id,
        business_name: d.business_name,
        description: d.description,
        profile_image_url: d.profile_image_url,
        categories: d.categories || [],
      }));
    },
    enabled: trimmed.length >= 2 && !!(lat && lng),
    staleTime: 2 * 60_000,
  });

  const groupedProducts = useMemo(() => {
    const groups: Record<string, any[]> = { products: [], services: [], bookable: [], enquiries: [] };
    productSuggestions.forEach((product: any) => groups[canonicalIntent(product.action_type)].push(product));
    return groups;
  }, [productSuggestions]);

  const hasResults = productSuggestions.length > 0 || sellerSuggestions.length > 0 || matchedCategories.length > 0;
  const optionCount = productSuggestions.length + sellerSuggestions.length + matchedCategories.length;
  const isVisible = trimmed.length >= 2 && hasResults && dismissedQuery !== trimmed;

  useEffect(() => {
    setActiveIndex(-1);
    if (dismissedQuery && dismissedQuery !== trimmed) setDismissedQuery('');
  }, [trimmed, dismissedQuery]);

  useEffect(() => {
    if (!isVisible || !rootRef.current) return;
    const input = rootRef.current.parentElement?.querySelector('input');
    if (!input) return;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listboxId);
    input.setAttribute('aria-expanded', 'true');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % optionCount);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1));
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        rootRef.current?.querySelector<HTMLButtonElement>(`[data-option-index="${activeIndex}"]`)?.click();
      } else if (event.key === 'Escape') {
        setDismissedQuery(trimmed);
        setActiveIndex(-1);
      }
    };

    input.addEventListener('keydown', handleKeyDown);
    return () => {
      input.removeEventListener('keydown', handleKeyDown);
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };
  }, [activeIndex, isVisible, listboxId, optionCount, trimmed]);

  useEffect(() => {
    const input = rootRef.current?.parentElement?.querySelector('input');
    if (!input) return;
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `${listboxId}-option-${activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }, [activeIndex, listboxId]);

  if (!isVisible) return null;

  let optionIndex = 0;
  const optionProps = () => {
    const index = optionIndex++;
    return {
      id: `${listboxId}-option-${index}`,
      role: 'option' as const,
      'aria-selected': activeIndex === index,
      'data-option-index': index,
      onMouseEnter: () => setActiveIndex(index),
      className: `w-full flex items-center gap-3 px-3 py-2.5 active:bg-muted transition-colors text-left border-b border-border last:border-0 ${
        activeIndex === index ? 'bg-muted' : 'hover:bg-muted/50'
      }`,
    };
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={rootRef}
        id={listboxId}
        role="listbox"
        aria-label="Search suggestions"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-[60vh] overflow-y-auto"
      >
        {INTENT_GROUPS.map(({ key, label, icon: GroupIcon }) => groupedProducts[key].length > 0 && (
          <div key={key} role="group" aria-label={label}>
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
              <GroupIcon size={11} className="text-muted-foreground" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            {groupedProducts[key].map((product: any) => (
              <button
                key={product.product_id}
                {...optionProps()}
                onClick={() => onSelect({
                  product_id: product.product_id,
                  product_name: product.product_name,
                  price: product.price,
                  image_url: product.image_url,
                  is_veg: product.is_veg,
                  category: product.category,
                  description: product.description,
                  seller_id: product.seller_id,
                  is_available: product.is_available,
                  action_type: product.action_type,
                  seller_name: product.seller_name || '',
                  seller_rating: product.seller_rating || 0,
                  seller_reviews: product.seller_total_reviews || 0,
                  society_name: product.society_name || null,
                  distance_km: product.distance_km || null,
                  is_same_society: (product.distance_km ?? 99) < 0.5,
                })}
              >
                <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm">📦</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{product.product_name}</p>
                  {product.seller_name && <p className="text-[11px] text-muted-foreground truncate">{product.seller_name}</p>}
                </div>
                <span className="text-[12px] font-bold text-primary shrink-0">{formatPrice(product.price)}</span>
              </button>
            ))}
          </div>
        ))}

        {sellerSuggestions.length > 0 && (
          <div role="group" aria-label="Stores">
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
              <Store size={11} className="text-muted-foreground" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Stores</span>
            </div>
            {sellerSuggestions.map((seller: any) => (
              <button key={seller.id} {...optionProps()} onClick={() => navigate(`/seller/${seller.id}`)}>
                <div className="w-8 h-8 rounded-lg bg-primary/10 overflow-hidden shrink-0 flex items-center justify-center">
                  {seller.profile_image_url ? <img src={seller.profile_image_url} alt="" className="w-full h-full object-cover" /> : <Store size={14} className="text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{seller.business_name}</p>
                  {seller.description && <p className="text-[11px] text-muted-foreground truncate">{seller.description}</p>}
                </div>
                <span className="text-[10px] font-medium text-primary shrink-0 bg-primary/10 px-2 py-0.5 rounded-full">Visit</span>
              </button>
            ))}
          </div>
        )}

        {matchedCategories.length > 0 && (
          <div role="group" aria-label="Categories">
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
              <Tag size={11} className="text-muted-foreground" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Categories</span>
            </div>
            {matchedCategories.map((cat) => (
              <button key={cat.slug} {...optionProps()} onClick={() => navigate(`/category/${cat.parentGroup}?sub=${cat.slug}`)}>
                <div className="w-8 h-8 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
                  {cat.imageUrl ? (
                    <img src={cat.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <DynamicIcon name={cat.icon || 'Tag'} size={16} className="text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-medium text-foreground truncate">{cat.displayName}</p>
                    {cat.matchedAlias && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">matches "{cat.matchedAlias}"</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Browse all {cat.displayName.toLowerCase()}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
