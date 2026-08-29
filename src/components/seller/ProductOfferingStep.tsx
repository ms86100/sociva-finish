import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ChevronRight } from 'lucide-react';

interface ProductOfferingStepProps {
  value: string;
  categoryLabel?: string | null;
  selectedSubcategoryNames?: string[];
  onChange: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onSelectSuggestion?: (name: string) => void;
}

export function ProductOfferingStep({
  value,
  categoryLabel,
  selectedSubcategoryNames = [],
  onChange,
  onBack,
  onContinue,
  onSelectSuggestion,
}: ProductOfferingStepProps) {
  const trimmed = value.trim();
  const canContinue = trimmed.length >= 2;

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} />Change buyer interaction
      </button>

      {/* If seller picked subcategories in Step 2, show them as pre-filled one-tap offerings */}
      {selectedSubcategoryNames.length > 0 && (
        <div className="space-y-2.5 p-4 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            Your Selected Offerings
          </p>
          <p className="text-xs text-muted-foreground">
            Tap any of your chosen services or products below to set it as your primary offering, or type a custom one:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {selectedSubcategoryNames.map((name) => {
              const isSelected = value.trim().toLowerCase() === name.trim().toLowerCase();
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(name);
                    if (onSelectSuggestion) onSelectSuggestion(name);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-background hover:bg-muted text-foreground border-border'
                  }`}
                >
                  {name} {isSelected && '✓'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="product-offering" className="text-sm font-medium">
          What exactly are you selling or providing?
        </label>
        {categoryLabel && (
          <p className="text-xs text-muted-foreground">
            Under <span className="font-medium text-foreground">{categoryLabel}</span>
          </p>
        )}
        <Input
          id="product-offering"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='e.g. "Bridal Makeup", "Facial Treatment", "Math Tuition"'
          className="h-12 text-base rounded-2xl"
          autoFocus={selectedSubcategoryNames.length === 0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canContinue) {
              e.preventDefault();
              onContinue();
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll pre-fill your first listing with this name. You can add pricing, details, or more items later.
        </p>
      </div>
      <Button className="w-full" disabled={!canContinue} onClick={onContinue}>
        Continue<ChevronRight size={16} className="ml-1" />
      </Button>
    </div>
  );
}
