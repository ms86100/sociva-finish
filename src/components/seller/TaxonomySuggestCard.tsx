import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { listingMatchBand, type ResolvedListingIntent } from '@/lib/listing-intent';
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

function prettyParentGroup(slug: string | null): string | null {
  if (!slug) return null;
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  const band = resolved.matchBand ?? listingMatchBand(resolved.confidence);
  const parentLabel = prettyParentGroup(resolved.suggestedParentGroup);
  const leafLabel =
    resolved.suggestedSubcategoryName
    || (resolved.needsOtherSubcategory ? 'Other' : null)
    || categoryDisplayName
    || resolved.suggestedCategorySlug;
  const pathParts = [
    parentLabel,
    categoryDisplayName && categoryDisplayName !== leafLabel ? categoryDisplayName : null,
    leafLabel,
  ].filter((part, i, arr) => part && arr.indexOf(part) === i);

  if (showBrowse && browseSlot) {
    return <div className="space-y-4">{browseSlot}</div>;
  }

  const heading = !hasSuggestion
    ? 'We couldn\'t find an exact match'
    : band === 'strong'
      ? `We found a category for ${intentPhrase || 'your item'}`
      : band === 'reasonable'
        ? `${intentPhrase || 'This'} looks closest to`
        : 'We couldn\'t find an exact match';

  const subcopy = !hasSuggestion
    ? 'Browse the existing catalog and pick the closest type. Your item name stays as you wrote it.'
    : band === 'weak'
      ? 'We found the closest existing category. Your item will still be listed under the name you entered.'
      : 'You can change this if it doesn\'t look right. Your item name is not a taxonomy node.';

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

        <p className="text-sm font-medium">{heading}</p>
        <p className="text-xs text-muted-foreground">{subcopy}</p>

        {hasSuggestion ? (
          <>
            <div className="rounded-xl bg-background border border-border px-3 py-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {band === 'weak' ? 'Closest existing category' : 'Suggested home'}
              </p>
              <p className="text-base font-semibold">{leafLabel}</p>
              {pathParts.length > 1 && (
                <p className="text-xs text-muted-foreground">{pathParts.join(' → ')}</p>
              )}
              {resolved.matchedAlias && resolved.matchedAlias !== 'closest parent' && (
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
              <Button className="w-full" onClick={band === 'weak' ? onContinueClosest : onConfirm}>
                {band === 'strong' ? 'Continue' : 'Continue with this'}
                <ChevronRight size={16} className="ml-1" />
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={onChangeTaxonomy}>
                <RefreshCw size={14} className="mr-1.5" />
                {band === 'weak' ? 'Choose another' : 'Change category'}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Button className="w-full" onClick={onChangeTaxonomy}>
              Browse categories<ChevronRight size={16} className="ml-1" />
            </Button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRequestCategory}
        className={cn(
          'w-full text-center text-xs text-muted-foreground hover:text-foreground py-1',
        )}
      >
        <Plus size={12} className="inline mr-1" />
        Can&apos;t find a suitable category? Request a new category
      </button>

      <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
        <ArrowRight size={12} />The seller defines the item. Sociva only suggests a type.
      </p>
    </div>
  );
}
