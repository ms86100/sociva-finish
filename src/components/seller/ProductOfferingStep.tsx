import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ChevronRight } from 'lucide-react';

interface ProductOfferingStepProps {
  value: string;
  categoryLabel?: string | null;
  onChange: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function ProductOfferingStep({
  value,
  categoryLabel,
  onChange,
  onBack,
  onContinue,
}: ProductOfferingStepProps) {
  const trimmed = value.trim();
  const canContinue = trimmed.length >= 2;

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} />Change buyer interaction
      </button>
      <div className="space-y-2">
        <label htmlFor="product-offering" className="text-sm font-medium">
          What exactly are you selling?
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
          placeholder='e.g. "Chicken biryani", "Math tuition", "Haircut"'
          className="h-12 text-base rounded-2xl"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canContinue) {
              e.preventDefault();
              onContinue();
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll pre-fill your first product with this name. You can edit it later.
        </p>
      </div>
      <Button className="w-full" disabled={!canContinue} onClick={onContinue}>
        Continue<ChevronRight size={16} className="ml-1" />
      </Button>
    </div>
  );
}
