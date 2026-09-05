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
import { ChevronRight, Search, Sparkles } from 'lucide-react';
import type { CategoryConfig } from '@/types/categories';

interface IntentCategoryStepProps {
  configs: CategoryConfig[];
  phrase: string;
  onPhraseChange: (phrase: string) => void;
  selectedCategorySlug: string | null;
  onSelectCategory: (slug: string) => void;
  onContinue: () => void;
  onBack?: () => void;
}

const DOMAIN_ORDER: SellerDomain[] = ['product', 'service', 'listing'];

export function IntentCategoryStep({
  configs,
  phrase,
  onPhraseChange,
  selectedCategorySlug,
  onSelectCategory,
  onContinue,
  onBack,
}: IntentCategoryStepProps) {
  const [domainFilter, setDomainFilter] = useState<SellerDomain | 'all'>('all');

  const activeConfigs = useMemo(
    () => configs.filter((c) => c.isActive),
    [configs],
  );

  const suggestion = useMemo(() => {
    const q = phrase.trim();
    if (q.length < 2) return null;
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
  }, [phrase, activeConfigs]);

  const showSuggestion = !!(suggestion && shouldSurfaceListingSuggestion(suggestion));
  const suggested = showSuggestion && suggestion?.suggestedCategorySlug
    ? activeConfigs.find((c) => c.category === suggestion.suggestedCategorySlug)
    : null;

  const lastAutoSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!suggested) {
      lastAutoSlugRef.current = null;
      return;
    }
    const slug = suggested.category;
    if (lastAutoSlugRef.current === slug) return;
    lastAutoSlugRef.current = slug;
    onSelectCategory(slug);
  }, [suggested, onSelectCategory]);

  const grouped = useMemo(() => {
    const map: Record<SellerDomain, CategoryConfig[]> = {
      product: [],
      service: [],
      listing: [],
    };
    for (const c of activeConfigs) {
      const domain = inferSellerDomain({
        sellerDomain: (c as any).sellerDomain,
        parentGroup: c.parentGroup,
        category: c.category,
        supportsCart: c.behavior.supportsCart,
        isPhysicalProduct: c.behavior.isPhysicalProduct,
        enquiryOnly: c.behavior.enquiryOnly,
        requiresTimeSlot: c.behavior.requiresTimeSlot,
        transactionType: c.transactionType,
      });
      map[domain].push(c);
    }
    return map;
  }, [activeConfigs]);

  const visibleDomains = DOMAIN_ORDER.filter(
    (d) => domainFilter === 'all' || domainFilter === d,
  );

  return (
    <div className="space-y-5">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
          ← Back
        </button>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">What would you like to sell?</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={phrase}
            onChange={(e) => onPhraseChange(e.target.value)}
            placeholder='e.g. "homemade food", "chess classes", "AC repair"'
            className="h-12 pl-9 rounded-2xl"
            autoFocus
          />
        </div>
      </div>

      {suggested && (
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
            <p className="text-[11px] text-muted-foreground">
              {SELLER_DOMAIN_LABEL[inferSellerDomain({
                sellerDomain: (suggested as any).sellerDomain,
                parentGroup: suggested.parentGroup,
                category: suggested.category,
                supportsCart: suggested.behavior.supportsCart,
                isPhysicalProduct: suggested.behavior.isPhysicalProduct,
                enquiryOnly: suggested.behavior.enquiryOnly,
                requiresTimeSlot: suggested.behavior.requiresTimeSlot,
                transactionType: suggested.transactionType,
              })]}
            </p>
          </div>
        </button>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button
          type="button"
          size="sm"
          variant={domainFilter === 'all' ? 'default' : 'outline'}
          className="rounded-xl h-8 text-xs shrink-0"
          onClick={() => setDomainFilter('all')}
        >
          All
        </Button>
        {DOMAIN_ORDER.map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={domainFilter === d ? 'default' : 'outline'}
            className="rounded-xl h-8 text-xs shrink-0"
            onClick={() => setDomainFilter(d)}
          >
            {SELLER_DOMAIN_LABEL[d]}
          </Button>
        ))}
      </div>

      <div className="space-y-4 max-h-[42vh] overflow-y-auto pr-1">
        {visibleDomains.map((domain) => {
          const list = grouped[domain];
          if (list.length === 0) return null;
          return (
            <div key={domain} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-0.5">
                {SELLER_DOMAIN_LABEL[domain]}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {list.map((c) => {
                  const selected = selectedCategorySlug === c.category;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={c.displayName}
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
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-md" aria-hidden>
                        {SELLER_DOMAIN_LABEL[domain]}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <Button className="w-full" disabled={!selectedCategorySlug} onClick={onContinue}>
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
  );
}
