import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { proposeOrReuseSubcategory } from '@/lib/propose-subcategory';
import { toast } from 'sonner';
import type { Subcategory } from '@/hooks/useSubcategories';

interface SubcategorySelectStepProps {
  categoryLabel: string;
  categoryConfigId: string;
  subcategories: Subcategory[];
  selectedId: string | null;
  onSelect: (sub: { id: string; displayName: string }) => void;
  sellerId?: string | null;
  onBack: () => void;
  onContinue: () => void;
  isLoading?: boolean;
}

export function SubcategorySelectStep({
  categoryLabel,
  categoryConfigId,
  subcategories,
  selectedId,
  onSelect,
  sellerId,
  onBack,
  onContinue,
  isLoading,
}: SubcategorySelectStepProps) {
  const queryClient = useQueryClient();
  const [proposeName, setProposeName] = useState('');
  const [proposing, setProposing] = useState(false);

  const list = useMemo(
    () => subcategories.filter((s) => s.is_active),
    [subcategories],
  );

  const handlePropose = async () => {
    const name = proposeName.trim();
    if (name.length < 2) {
      toast.error('Enter a name with at least 2 characters');
      return;
    }
    setProposing(true);
    try {
      const result = await proposeOrReuseSubcategory({
        categoryConfigId,
        displayName: name,
        sellerId,
      });
      onSelect({ id: result.subcategoryId, displayName: result.displayName });
      setProposeName('');
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      toast.success(
        result.createdNew
          ? `"${result.displayName}" added — you can use it now`
          : `Using existing "${result.displayName}"`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Could not add subcategory', {
        duration: 6000,
        id: 'propose-subcategory-error',
      });
    } finally {
      setProposing(false);
    }
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        ← Change category
      </button>

      <div>
        <p className="text-sm font-medium">Pick a subcategory for {categoryLabel}</p>
        <p className="text-xs text-muted-foreground mt-1">
          This becomes the initial name of your listing. You can edit the listing details next.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8 text-muted-foreground gap-2">
          <Loader2 className="animate-spin" size={18} /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto">
          {list.map((s) => {
            const selected = selectedId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect({ id: s.id, displayName: s.display_name })}
                className={cn(
                  'text-left p-3 rounded-xl border-2 text-sm font-medium transition-all',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                )}
              >
                {s.display_name}
              </button>
            );
          })}
          {list.length === 0 && (
            <p className="col-span-2 text-xs text-muted-foreground text-center py-4">
              No subcategories yet — propose one below.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2 border rounded-2xl p-3">
        <p className="text-xs font-semibold text-muted-foreground">Don&apos;t see yours? Add it now</p>
        <div className="flex gap-2">
          <Input
            value={proposeName}
            onChange={(e) => setProposeName(e.target.value)}
            placeholder="e.g. Homemade Food"
            className="h-10 rounded-xl"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handlePropose();
              }
            }}
          />
          <Button type="button" variant="outline" className="shrink-0 rounded-xl" disabled={proposing} onClick={() => void handlePropose()}>
            {proposing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Available immediately. Similar names are cleaned up automatically later.
        </p>
      </div>

      <Button className="w-full" disabled={!selectedId} onClick={onContinue}>
        Continue
        <ChevronRight size={16} className="ml-1" />
      </Button>
    </div>
  );
}
