import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import {
  inferSellerDomain,
  SELLER_DOMAIN_LABEL,
  type SellerDomain,
} from '@/lib/seller-domain';
import { resolveListingIntent, shouldSurfaceListingSuggestion } from '@/lib/listing-intent';
import {
  BUYER_REACH_COPY,
  DOMAIN_REACH_HELP,
  categoryMatchesReach,
  defaultReachForDomain,
  reachesForDomain,
  type BuyerReachId,
} from '@/lib/buyer-reach';
import { ChevronRight, Search, Sparkles, ShoppingCart, Calendar, Phone, Package, Wrench, ClipboardList } from 'lucide-react';
import type { CategoryConfig } from '@/types/categories';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type Phase = 'domain' | 'reach' | 'category';

export type IntentContinuePayload = {
  categorySlug: string;
  reach: BuyerReachId;
  domain: SellerDomain;
};

interface IntentCategoryStepProps {
  configs: CategoryConfig[];
  phrase: string;
  onPhraseChange: (phrase: string) => void;
  selectedCategorySlug: string | null;
  onSelectCategory: (slug: string) => void;
  onContinue: (payload: IntentContinuePayload) => void;
  onBack?: () => void;
}

const DOMAIN_ORDER: SellerDomain[] = ['product', 'service', 'listing'];

const DOMAIN_ICONS: Record<SellerDomain, typeof Package> = {
  product: Package,
  service: Wrench,
  listing: ClipboardList,
};

const REACH_ICONS: Record<BuyerReachId, typeof ShoppingCart> = {
  cart: ShoppingCart,
  book: Calendar,
  contact: Phone,
};

function categoryInput(c: CategoryConfig) {
  return {
    sellerDomain: (c as any).sellerDomain,
    parentGroup: c.parentGroup,
    category: c.category,
    supportsCart: c.behavior.supportsCart,
    isPhysicalProduct: c.behavior.isPhysicalProduct,
    enquiryOnly: c.behavior.enquiryOnly,
    requiresTimeSlot: c.behavior.requiresTimeSlot,
    transactionType: c.transactionType,
    defaultActionType: (c as any).defaultActionType,
  };
}

export function IntentCategoryStep({
  configs,
  phrase,
  onPhraseChange,
  selectedCategorySlug,
  onSelectCategory,
  onContinue,
  onBack,
}: IntentCategoryStepProps) {
  const [phase, setPhase] = useState<Phase>('domain');
  const [domain, setDomain] = useState<SellerDomain | null>(null);
  const [reach, setReach] = useState<BuyerReachId | null>(null);

  const activeConfigs = useMemo(
    () => configs.filter((c) => c.isActive),
    [configs],
  );

  const allowedByConfigId = useQuery({
    queryKey: ['all-category-allowed-actions'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('category_allowed_action_types')
        .select('category_config_id, action_type');
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const row of data || []) {
        const id = String(row.category_config_id);
        const list = map.get(id) || [];
        list.push(String(row.action_type));
        map.set(id, list);
      }
      return map;
    },
    staleTime: 1000 * 60 * 30,
  });

  const suggestion = useMemo(() => {
    const q = phrase.trim();
    if (q.length < 2 || phase !== 'category') return null;
    return resolveListingIntent({
      phrase: q,
      categories: activeConfigs.map((c) => ({
        id: c.id,
        slug: c.category,
        displayName: c.displayName,
        parentGroup: c.parentGroup,
        supportsCart: c.behavior.supportsCart,
        enquiryOnly: c.behavior.enquiryOnly,
        requiresTimeSlot: c.behavior.requiresTimeSlot,
        hasDateRange: c.behavior.hasDateRange,
        transactionType: c.transactionType || undefined,
      })),
      subcategories: [],
    });
  }, [phrase, activeConfigs, phase]);

  const showSuggestion = !!(suggestion && shouldSurfaceListingSuggestion(suggestion));
  const suggested = showSuggestion && suggestion?.suggestedCategorySlug
    ? activeConfigs.find((c) => c.category === suggestion.suggestedCategorySlug)
    : null;

  const filteredCategories = useMemo(() => {
    if (!domain || !reach) return [];
    return activeConfigs.filter((c) => {
      const input = categoryInput(c);
      if (inferSellerDomain(input) !== domain) return false;
      const allowed = allowedByConfigId.data?.get(c.id) ?? null;
      return categoryMatchesReach(input, reach, allowed);
    });
  }, [activeConfigs, domain, reach, allowedByConfigId.data]);

  const lastAutoSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!suggested || phase !== 'category') {
      lastAutoSlugRef.current = null;
      return;
    }
    if (!filteredCategories.some((c) => c.category === suggested.category)) return;
    const slug = suggested.category;
    if (lastAutoSlugRef.current === slug) return;
    lastAutoSlugRef.current = slug;
    onSelectCategory(slug);
  }, [suggested, onSelectCategory, phase, filteredCategories]);

  const pickDomain = (d: SellerDomain) => {
    setDomain(d);
    const options = reachesForDomain(d);
    if (options.length === 1) {
      setReach(options[0]);
      setPhase('category');
      onSelectCategory('');
    } else {
      setReach(defaultReachForDomain(d));
      setPhase('reach');
      onSelectCategory('');
    }
  };

  const pickReach = (r: BuyerReachId) => {
    setReach(r);
    onSelectCategory('');
    setPhase('category');
  };

  const handleBack = () => {
    if (phase === 'category') {
      if (domain && reachesForDomain(domain).length > 1) {
        setPhase('reach');
        onSelectCategory('');
        return;
      }
      setPhase('domain');
      setDomain(null);
      setReach(null);
      onSelectCategory('');
      return;
    }
    if (phase === 'reach') {
      setPhase('domain');
      setDomain(null);
      setReach(null);
      return;
    }
    onBack?.();
  };

  const reachCopy = reach ? BUYER_REACH_COPY[reach] : null;
  const selectedCat = selectedCategorySlug
    ? filteredCategories.find((c) => c.category === selectedCategorySlug)
    : null;

  return (
    <div className="space-y-5">
      {(phase !== 'domain' || onBack) && (
        <button type="button" onClick={handleBack} className="flex items-center gap-1 text-sm text-muted-foreground">
          ← Back
        </button>
      )}

      {phase === 'domain' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold">What kind of store is this?</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Choose Product, Service, or Listing — we will then ask how buyers should reach you.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {DOMAIN_ORDER.map((d) => {
              const Icon = DOMAIN_ICONS[d];
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDomain(d)}
                  className="flex items-start gap-3 p-4 rounded-2xl border-2 border-border text-left hover:border-primary/40 transition-all"
                >
                  <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{SELLER_DOMAIN_LABEL[d]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{DOMAIN_REACH_HELP[d]}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground mt-1 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'reach' && domain && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {SELLER_DOMAIN_LABEL[domain]}
            </p>
            <h3 className="text-base font-semibold mt-1">How should buyers reach you?</h3>
            <p className="text-xs text-muted-foreground mt-1">
              This sets the button buyers see on your listings.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {reachesForDomain(domain).map((r) => {
              const Icon = REACH_ICONS[r];
              const copy = BUYER_REACH_COPY[r];
              const selected = reach === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => pickReach(r)}
                  className={cn(
                    'flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all',
                    selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                  )}
                >
                  <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', selected ? 'bg-primary/10' : 'bg-muted')}>
                    <Icon size={20} className={selected ? 'text-primary' : 'text-foreground'} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{copy.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{copy.help}</p>
                    <Badge variant="secondary" className="mt-2 text-[10px] h-5 rounded-md">
                      {copy.badge}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'category' && domain && reach && reachCopy && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs space-y-1">
            <p>
              <span className="font-semibold">{SELLER_DOMAIN_LABEL[domain]}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold text-primary">{reachCopy.badge}</span>
            </p>
            <p className="text-muted-foreground">{reachCopy.summary}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Pick a category</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={phrase}
                onChange={(e) => onPhraseChange(e.target.value)}
                placeholder='e.g. "salon", "homemade food", "maid"'
                className="h-12 pl-9 rounded-2xl"
                autoFocus
              />
            </div>
          </div>

          {suggested && filteredCategories.some((c) => c.id === suggested.id) && (
            <button
              type="button"
              onClick={() => onSelectCategory(suggested.category)}
              className={cn(
                'w-full text-left rounded-2xl border-2 p-3 flex items-center gap-3 transition-all',
                selectedCategorySlug === suggested.category
                  ? 'border-primary bg-primary/5'
                  : 'border-primary/30 bg-primary/[0.03]',
              )}
            >
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', suggested.color)}>
                <DynamicIcon name={suggested.icon} size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
                  <Sparkles size={10} /> Suggested match
                </p>
                <p className="text-sm font-bold truncate">{suggested.displayName}</p>
              </div>
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-md shrink-0">
                {reachCopy.badge}
              </Badge>
            </button>
          )}

          <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
            {filteredCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No categories match this combination yet. Go back and try another option.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredCategories.map((c) => {
                  const selected = selectedCategorySlug === c.category;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={`${c.displayName}. ${reachCopy.help}`}
                      title={reachCopy.help}
                      onClick={() => onSelectCategory(c.category)}
                      className={cn(
                        'flex flex-col items-start gap-2 p-3 rounded-xl border-2 text-left min-h-[88px] transition-all',
                        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', c.color)}>
                        <DynamicIcon name={c.icon} size={16} />
                      </div>
                      <span className="text-xs font-semibold leading-tight">{c.displayName}</span>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-md">
                        {reachCopy.badge}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCat && (
            <p className="text-xs text-center text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedCat.displayName}</span>
              {' — '}
              {reachCopy.summary}
            </p>
          )}

          <div className="space-y-1.5">
            <Button
              className="w-full"
              disabled={!selectedCategorySlug}
              onClick={() => {
                if (!selectedCategorySlug || !domain || !reach) return;
                onContinue({ categorySlug: selectedCategorySlug, reach, domain });
              }}
            >
              Continue
              <ChevronRight size={16} className="ml-1" />
            </Button>
            {!selectedCategorySlug && (
              <p className="text-center text-[11px] text-muted-foreground">
                Pick a category above to continue.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
