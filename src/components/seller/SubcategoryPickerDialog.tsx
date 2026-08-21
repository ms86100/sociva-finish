// @ts-nocheck
import { useEffect, useState, useMemo, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useSubcategories, Subcategory } from '@/hooks/useSubcategories';
import { useResolvedCategoryAliases } from '@/hooks/useResolvedCategoryAliases';
import { RequestSubcategoryDialog } from '@/components/seller/RequestSubcategoryDialog';
import { findBestSubcategoryMatch } from '@/lib/listing-intent';
import { Search, Star, Check, AlertTriangle, Loader2, Plus, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Identity Map ────────────────────────────────────────────────────────────
const IDENTITY_MAP: Record<string, string> = {
  daily_tiffin: 'Tiffin Provider',
  one_time_meals: 'Home Meal Provider',
  breakfast_items: 'Breakfast Specialist',
  cakes: 'Home Baker',
  cookies_biscuits: 'Home Baker',
  traditional_sweets: 'Sweet Maker',
  fresh_juices: 'Juice Bar',
  pickles: 'Homemade Specialty Seller',
  party_catering: 'Catering Service',
  party_snacks: 'Snack Caterer',
  organic_food: 'Organic Food Seller',
  regional_cuisine: 'Regional Cuisine Specialist',
  healthy_diet: 'Healthy Meal Provider',
  kids_meals: 'Kids Meal Specialist',
  namkeen_chips: 'Snack Seller',
  street_food: 'Street Food Specialist',
  tea_coffee: 'Chai & Coffee Seller',
  smoothies: 'Smoothie Bar',
  milkshakes: 'Milkshake Bar',
  homemade_chocolates: 'Chocolate Maker',
  jams_preserves: 'Preserves Maker',
  masala_spices: 'Spice Seller',
  papad_fryums: 'Homemade Snack Seller',
  free_food: 'Community Contributor',
  leftovers: 'Community Contributor',
};

function getIdentityLabel(subcategory: Subcategory | undefined, categoryName: string): string {
  if (!subcategory) return `${categoryName} Seller`;
  // Try slug match first
  const slug = subcategory.slug;
  if (IDENTITY_MAP[slug]) return IDENTITY_MAP[slug];
  // Fallback: use subcategory display name
  return `${subcategory.display_name} Seller`;
}

// ─── Search Scoring ──────────────────────────────────────────────────────────
function scoreSubcategory(sub: Subcategory, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const name = sub.display_name.toLowerCase();
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  if (name.includes(q)) return 1;
  return 0;
}

// ─── Selection State ─────────────────────────────────────────────────────────
export interface SubcategorySelection {
  primary: string | null;
  others: string[];
  /** Optional seller-edited identity label that overrides the auto-generated one. */
  customLabel?: string | null;
}

interface SubcategoryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryConfigId: string;
  categoryName: string;
  categoryIcon: string;
  /** Slug of the parent category (e.g. "snacks") — required to enable subcategory requests */
  categorySlug?: string;
  /** Slug of the parent group (e.g. "food_beverages") — used for request metadata */
  parentGroupSlug?: string | null;
  /** Search text that opened this picker, so category-level aliases remain visible inside the category */
  initialSearch?: string;
  selected: SubcategorySelection;
  onSave: (selection: SubcategorySelection) => void;
}

const SOFT_LIMIT = 5;

export function SubcategoryPickerDialog({
  open,
  onOpenChange,
  categoryConfigId,
  categoryName,
  categoryIcon,
  categorySlug,
  parentGroupSlug,
  initialSearch = '',
  selected,
  onSave,
}: SubcategoryPickerDialogProps) {
  const { data: subcategories, isLoading } = useSubcategories(categoryConfigId);
  const { data: resolvedAliases = [] } = useResolvedCategoryAliases();
  const [search, setSearch] = useState('');
  const [localSelection, setLocalSelection] = useState<SubcategorySelection>(selected);
  const [requestOpen, setRequestOpen] = useState(false);
  const [detectedChip, setDetectedChip] = useState<string | null>(null);
  const [otherHint, setOtherHint] = useState<string | null>(null);
  const autoResolvedRef = useRef<string | null>(null);

  // Only re-seed local state when the dialog actually opens or the target
  // category changes. Depending on `selected` would reset the user's in-progress
  // selection on every parent re-render (the parent passes a fresh default
  // object literal each time), causing checkboxes to immediately uncheck.
  useEffect(() => {
    if (!open) {
      autoResolvedRef.current = null;
      return;
    }
    setLocalSelection(selected);
    setDetectedChip(null);
    setOtherHint(null);
    // Seed search briefly; auto-resolve effect clears stuck empty filters.
    setSearch(initialSearch?.trim() || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, categoryConfigId]);

  // Auto-select best subcategory from intent phrase; never leave stuck empty search.
  useEffect(() => {
    if (!open || !subcategories?.length) return;
    const phrase = (initialSearch || '').trim();
    if (!phrase) return;
    const resolveKey = `${categoryConfigId}:${phrase}`;
    if (autoResolvedRef.current === resolveKey) return;
    autoResolvedRef.current = resolveKey;

    if (selected.primary) {
      setSearch('');
      return;
    }

    const catalog = subcategories.map((s) => ({
      id: s.id,
      slug: s.slug,
      displayName: s.display_name,
      categoryConfigId: s.category_config_id,
      categorySlug: categorySlug || '',
    }));
    const hit = findBestSubcategoryMatch(phrase, catalog, { categoryConfigId });
    if (hit && hit.score >= 1) {
      setLocalSelection({ primary: hit.sub.id, others: [], customLabel: null });
      setDetectedChip(`${categoryName} → ${hit.sub.displayName}`);
      setOtherHint(null);
      setSearch('');
    } else {
      // Clear stuck query so the full list remains usable; offer Other path.
      setSearch('');
      setDetectedChip(null);
      setOtherHint(phrase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, categoryConfigId, subcategories]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  const continueAsOther = () => {
    const label = (otherHint || initialSearch || 'Other').trim() || 'Other';
    setLocalSelection({ primary: null, others: [], customLabel: label });
    setDetectedChip(`${categoryName} → Other`);
    setOtherHint(null);
  };




  // Sorted & scored subcategories, with dynamic aliases from
  // approved/merged subcategory requests (e.g. "makhana" → subcategory id)
  const sortedSubs = useMemo(() => {
    if (!subcategories) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [...subcategories].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));

    // Build a map: subcategory id → matched alias score (only for resolved
    // subcategory requests that point at one of this category's subs).
    const subIds = new Set(subcategories.map(s => s.id));
    const aliasBoost = new Map<string, number>();
    for (const a of resolvedAliases) {
      if (!a.resolvedSubcategoryId || !subIds.has(a.resolvedSubcategoryId)) continue;
      if (a.alias === q) aliasBoost.set(a.resolvedSubcategoryId, Math.max(aliasBoost.get(a.resolvedSubcategoryId) ?? 0, 3));
      else if (a.alias.startsWith(q) || q.startsWith(a.alias)) aliasBoost.set(a.resolvedSubcategoryId, Math.max(aliasBoost.get(a.resolvedSubcategoryId) ?? 0, 2));
      else if (a.alias.includes(q) || q.includes(a.alias)) aliasBoost.set(a.resolvedSubcategoryId, Math.max(aliasBoost.get(a.resolvedSubcategoryId) ?? 0, 1));
    }

    return [...subcategories]
      .map(s => ({ ...s, _score: Math.max(scoreSubcategory(s, q), aliasBoost.get(s.id) ?? 0) }))
      .filter(s => s._score > 0)
      .sort((a, b) => b._score - a._score);
  }, [subcategories, search, resolvedAliases]);

  const totalSelected = (localSelection.primary ? 1 : 0) + localSelection.others.length;

  const isSelected = (id: string) => localSelection.primary === id || localSelection.others.includes(id);
  const isPrimary = (id: string) => localSelection.primary === id;

  const toggleSubcategory = (id: string) => {
    setLocalSelection(prev => {
      // If already selected, remove it
      if (prev.primary === id) {
        // Demote: promote first other
        const [newPrimary, ...rest] = prev.others;
        // Primary changed → drop any seller-edited label so the new default shows
        return { primary: newPrimary || null, others: rest, customLabel: null };
      }
      if (prev.others.includes(id)) {
        return { ...prev, others: prev.others.filter(o => o !== id) };
      }
      // New selection
      if (!prev.primary) {
        // First pick → primary (fresh default label)
        return { ...prev, primary: id, customLabel: null };
      }
      // Additional → secondary
      return { ...prev, others: [...prev.others, id] };
    });
  };

  const makePrimary = (id: string) => {
    setLocalSelection(prev => {
      if (prev.primary === id) return prev;
      const othersWithoutNew = prev.others.filter(o => o !== id);
      const newOthers = prev.primary ? [prev.primary, ...othersWithoutNew] : othersWithoutNew;
      // Primary changed → drop the seller-edited label so the new default shows
      return { primary: id, others: newOthers, customLabel: null };
    });
  };

  const handleDone = () => {
    onSave(localSelection);
    onOpenChange(false);
  };




  const primarySub = subcategories?.find(s => s.id === localSelection.primary);
  const identityLabel = getIdentityLabel(primarySub, categoryName);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] flex flex-col overflow-y-auto pb-[max(1.5rem,var(--keyboard-inset,0px))]">
        <SheetHeader className="text-left pb-2">
          <SheetTitle className="flex items-center gap-2">
            <DynamicIcon name={categoryIcon} size={20} />
            {categoryName}
          </SheetTitle>
        </SheetHeader>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='What are you looking to sell?'
            className="pl-9"
          />
        </div>

        {detectedChip && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 text-xs text-primary">
            <Sparkles size={14} className="shrink-0" />
            <span>Detected: <span className="font-semibold">{detectedChip}</span></span>
          </div>
        )}

        {otherHint && !localSelection.primary && (
          <div className="mb-3 p-3 rounded-xl border border-dashed border-border space-y-2">
            <p className="text-xs text-muted-foreground">
              No exact subcategory for &quot;{otherHint}&quot;. Pick the closest below, request a new one, or continue as Other.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" className="rounded-xl h-8 text-xs" onClick={continueAsOther}>
                Continue as Other
              </Button>
              {categorySlug && (
                <Button type="button" size="sm" variant="outline" className="rounded-xl h-8 text-xs" onClick={() => setRequestOpen(true)}>
                  <Plus size={12} className="mr-1" />Request subcategory
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Guidance */}
        <p className="text-xs text-muted-foreground mb-2">
          ⭐ First pick becomes your <span className="font-semibold">primary specialty</span>. Pick 1–{SOFT_LIMIT} to start.
        </p>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 -mx-1 px-1">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground" size={24} />
            </div>
          )}
          {!isLoading && sortedSubs.length === 0 && (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
                <Search size={20} className="text-muted-foreground" />
              </div>
              {search.trim() ? (
                <>
                  <p className="text-sm font-medium">No match for "{search.trim()}" in {categoryName}</p>
                  <p className="text-xs text-muted-foreground px-4">
                    Pick the closest option above, or ask us to add "{search.trim()}" as a new subcategory.
                  </p>
                  {categorySlug && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setRequestOpen(true)}
                    >
                      <Plus size={14} className="mr-1.5" />
                      Request "{search.trim().slice(0, 24)}{search.trim().length > 24 ? '…' : ''}"
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No subcategories available</p>
                  {categorySlug && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setRequestOpen(true)}
                    >
                      <Plus size={14} className="mr-1.5" />
                      Request a new subcategory
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {sortedSubs.map((sub) => {
            const selected = isSelected(sub.id);
            const primary = isPrimary(sub.id);
            const isRecommended = '_score' in sub && (sub as any)._score === 3;

            return (
              <button
                key={sub.id}
                onClick={() => toggleSubcategory(sub.id)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                  selected
                    ? primary
                      ? 'border-primary bg-primary/10'
                      : 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                )}
              >
                {/* Icon */}
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm',
                  selected ? 'bg-primary/20' : 'bg-muted'
                )}>
                  {sub.icon ? <DynamicIcon name={sub.icon} size={16} /> : '🍽️'}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{sub.display_name}</span>
                    {isRecommended && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 shrink-0">
                        ⭐ Recommended
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Selection indicator */}
                <div className="shrink-0">
                  {primary ? (
                    <button
                      onClick={e => { e.stopPropagation(); }}
                      className="flex items-center gap-1"
                    >
                      <Star size={16} className="fill-primary text-primary" />
                    </button>
                  ) : selected ? (
                    <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                      <Check size={12} className="text-primary" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded border border-border" />
                  )}
                </div>

                {/* Make primary button (for non-primary selected items) */}
                {selected && !primary && (
                  <button
                    onClick={e => { e.stopPropagation(); makePrimary(sub.id); }}
                    className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                    title="Make primary"
                  >
                    <Star size={14} />
                  </button>
                )}
              </button>
            );
          })}

          {/* Always-available "Don't see it?" affordance */}
          {!isLoading && categorySlug && sortedSubs.length > 0 && (
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="w-full mt-2 flex items-center gap-2 p-3 rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-muted/30 text-left text-xs text-muted-foreground transition"
            >
              <Plus size={14} className="text-primary" />
              <span>Don't see what you sell? <span className="font-medium text-foreground">Request a new subcategory</span></span>
            </button>
          )}
        </div>

        {/* Soft limit warning */}
        {totalSelected > SOFT_LIMIT && (
          <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-warning/10 text-warning text-xs">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Too many selections may confuse buyers. Consider picking your top {SOFT_LIMIT}.</span>
          </div>
        )}

        {/* Identity feedback (editable) */}
        {(localSelection.primary || localSelection.customLabel) && (
          <EditableIdentityLabel
            defaultLabel={localSelection.customLabel || identityLabel}
            value={localSelection.customLabel ?? ''}
            onChange={(next) =>
              setLocalSelection(prev => ({
                ...prev,
                customLabel: next.trim() && next.trim() !== identityLabel ? next.trim() : (prev.primary ? null : (next.trim() || 'Other')),
              }))
            }
          />
        )}

        {/* Footer */}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground flex-1">
            {totalSelected === 0
              ? (localSelection.customLabel ? `Other: ${localSelection.customLabel}` : 'No selections')
              : `${totalSelected} selected`}
          </span>
          <Button
            onClick={handleDone}
            className="min-w-[100px]"
            disabled={totalSelected === 0 && !localSelection.customLabel}
          >
            Done {totalSelected > 0 && `(${totalSelected})`}
          </Button>
        </div>
      </SheetContent>

      {categorySlug && (
        <RequestSubcategoryDialog
          open={requestOpen}
          onOpenChange={setRequestOpen}
          initialName={search.trim()}
          parentCategoryConfigId={categoryConfigId}
          parentCategoryName={categoryName}
          parentCategorySlug={categorySlug}
          parentGroupSlug={parentGroupSlug ?? null}
        />
      )}
    </Sheet>
  );
}

// ─── Editable Identity Label ────────────────────────────────────────────────
function EditableIdentityLabel({
  defaultLabel,
  value,
  onChange,
}: {
  defaultLabel: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || defaultLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync draft when entering edit mode or when default changes (new primary)
  useEffect(() => {
    setDraft(value || defaultLabel);
  }, [value, defaultLabel, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
  }, [editing]);

  const isCustom = !!value && value !== defaultLabel;
  const displayed = isCustom ? value : defaultLabel;

  const commit = () => {
    const trimmed = draft.trim();
    onChange(trimmed && trimmed !== defaultLabel ? trimmed : '');
    setEditing(false);
  };

  const reset = () => {
    onChange('');
    setDraft(defaultLabel);
    setEditing(false);
  };

  return (
    <div className="mt-3 p-3 rounded-lg bg-muted">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Seller role (how buyers describe you)</p>
        {!editing && (
          <div className="flex items-center gap-1">
            {isCustom && (
              <button
                type="button"
                onClick={reset}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-background/60 transition"
                aria-label="Reset to suggested label"
              >
                <RotateCcw size={10} /> Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-background/60 transition"
              aria-label="Edit your seller title"
            >
              <Pencil size={10} /> Edit
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-1 flex items-center gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setDraft(value || defaultLabel); setEditing(false); }
            }}
            placeholder={defaultLabel}
            className="h-8 text-sm font-semibold text-center"
            maxLength={40}
          />
          <Button type="button" size="sm" className="h-8 shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
            Done
          </Button>
        </div>
      ) : (
        <p className="text-sm font-semibold text-foreground text-center mt-0.5">
          {displayed}
        </p>
      )}

      <p className="text-[10px] text-muted-foreground text-center mt-1">
        {editing
          ? `${draft.length}/40 — this is your specialty label, not your store name`
          : 'Shown as your specialty (for example, Home Meal Provider). Your store name comes next.'}
      </p>
    </div>
  );
}
