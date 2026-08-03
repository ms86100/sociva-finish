import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import type { ResolvedListingIntent } from '@/lib/listing-intent';
import { ArrowRight, ChevronRight, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface TaxonomySuggestCardProps {
  intentPhrase: string;
  resolved: ResolvedListingIntent;
  categoryDisplayName: string | null;
  categoryIcon?: string | null;
  onConfirm: () => void;
  onChangeTaxonomy: () => void;
  onRequestCategory: () => void;
  onContinueClosest: () => void;
  showBrowse?: boolean;
  browseSlot?: ReactNode;
}

export function TaxonomySuggestCard({
  intentPhrase,
  resolved,
  categoryDisplayName,
  categoryIcon,
  onConfirm,
  onChangeTaxonomy,
  onRequestCategory,
  onContinueClosest,
  showBrowse = false,
  browseSlot,
}: TaxonomySuggestCardProps) {
  const hasSuggestion = !!resolved.suggestedCategorySlug;
  const pathLabel = hasSuggestion
    ? [
        categoryDisplayName || resolved.suggestedCategorySlug,
        resolved.suggestedSubcategoryName || (resolved.needsOtherSubcategory ? 'Other' : null),
      ]
        .filter(Boolean)
        .join(' → ')
    : null;

  if (showBrowse && browseSlot) {
    return <div className="space-y-4">{browseSlot}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            {categoryIcon ? (
              <DynamicIcon name={categoryIcon} size={20} />
            ) : (
              <Sparkles size={18} className="text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground mb-1">You said</p>
            <p className="text-sm font-medium truncate">&quot;{intentPhrase}&quot;</p>
          </div>
        </div>

        {hasSuggestion ? (
          <>
            <div className="rounded-xl bg-background border border-border px-3 py-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggested home</p>
              <p className="text-base font-semibold">{pathLabel}</p>
              {resolved.matchedAlias && (
                <Badge variant="secondary" className="text-[10px] mt-1">
                  Matched: {resolved.matchedAlias}
                </Badge>
              )}
              {resolved.needsOtherSubcategory && (
                <p className="text-xs text-muted-foreground pt-1">
                  No exact subcategory — we&apos;ll use Other / your description so you can continue.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={onConfirm}>
                Looks right — continue<ChevronRight size={16} className="ml-1" />
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={onChangeTaxonomy}>
                <RefreshCw size={14} className="mr-1.5" />Change category
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t place that yet. Browse categories, continue with the closest match once you pick one, or request a new category.
            </p>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={onChangeTaxonomy}>
                Browse categories<ChevronRight size={16} className="ml-1" />
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={onRequestCategory}>
                <Plus size={14} className="mr-1.5" />Can&apos;t find it — request category
              </Button>
            </div>
          </>
        )}
      </div>

      {hasSuggestion && (
        <button
          type="button"
          onClick={onContinueClosest}
          className={cn(
            'w-full text-center text-xs text-muted-foreground hover:text-foreground py-1',
          )}
        >
          Continue with closest match
        </button>
      )}

      <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
        <ArrowRight size={12} />Taxonomy is a suggestion — you can always adjust later
      </p>
    </div>
  );
}
