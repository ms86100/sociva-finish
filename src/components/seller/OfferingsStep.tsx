import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ChevronRight, Plus, X } from 'lucide-react';

interface OfferingsStepProps {
  names: string[];
  suggestionChips?: string[];
  stampHint?: string | null;
  error?: string | null;
  onChangeNames: (names: string[]) => void;
  onBack: () => void;
  onContinue: () => void;
}

function titleCase(value: string): string {
  const t = value.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function OfferingsStep({
  names,
  suggestionChips = [],
  stampHint,
  error,
  onChangeNames,
  onBack,
  onContinue,
}: OfferingsStepProps) {
  const rows = names.length > 0 ? names : [''];
  const filled = rows.map((n) => n.trim()).filter((n) => n.length >= 2);
  const canContinue = filled.length >= 1;

  const selectedKeys = useMemo(
    () => new Set(filled.map((n) => n.toLowerCase())),
    [filled],
  );

  const setRow = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChangeNames(next);
  };

  const addRow = () => {
    onChangeNames([...rows, '']);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) {
      onChangeNames(['']);
      return;
    }
    onChangeNames(rows.filter((_, i) => i !== index));
  };

  const toggleChip = (chip: string) => {
    const key = chip.toLowerCase();
    const existing = rows.findIndex((n) => n.trim().toLowerCase() === key);
    if (existing >= 0) {
      removeRow(existing);
      return;
    }
    const emptyIndex = rows.findIndex((n) => !n.trim());
    if (emptyIndex >= 0) {
      const next = [...rows];
      next[emptyIndex] = chip;
      onChangeNames(next);
      return;
    }
    onChangeNames([...rows, chip]);
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} />Change buyer interaction
      </button>

      {suggestionChips.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Tap a known offering, or type your own</p>
          <div className="flex flex-wrap gap-2">
            {suggestionChips.map((name) => {
              const selected = selectedKeys.has(name.trim().toLowerCase());
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleChip(name)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-background hover:bg-muted text-foreground border-border'
                  }`}
                >
                  {name}{selected ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="text-sm font-medium">What do you offer?</label>
        {rows.map((name, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setRow(index, e.target.value)}
              placeholder={index === 0 ? 'e.g. Rajma Chawal, Facial, AC repair' : 'Add another offering'}
              className="h-12 text-base rounded-2xl"
              autoFocus={index === 0 && suggestionChips.length === 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (index === rows.length - 1 && name.trim().length >= 2) addRow();
                  else if (canContinue && index === rows.length - 1) onContinue();
                }
              }}
              onBlur={() => {
                const titled = titleCase(name);
                if (titled !== name) setRow(index, titled);
              }}
            />
            {(rows.length > 1 || name.trim()) && (
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="shrink-0 w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-muted"
                aria-label="Remove offering"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" className="w-full" onClick={addRow}>
          <Plus size={14} className="mr-1" />Add another
        </Button>
        <p className="text-xs text-muted-foreground">
          Use the names buyers would search for. We&apos;ll set up draft listings with these names.
        </p>
      </div>

      {stampHint && (
        <p className="text-xs text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
          {stampHint}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <Button className="w-full" disabled={!canContinue} onClick={onContinue}>
        Continue<ChevronRight size={16} className="ml-1" />
      </Button>
    </div>
  );
}
