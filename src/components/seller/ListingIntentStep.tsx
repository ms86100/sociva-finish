import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { INTENT_EXAMPLE_CHIPS } from '@/lib/listing-intent';
import { ArrowRight, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListingIntentStepProps {
  value: string;
  onChange: (phrase: string) => void;
  onContinue: () => void;
}

export function ListingIntentStep({ value, onChange, onContinue }: ListingIntentStepProps) {
  const canContinue = value.trim().length >= 2;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="listing-intent" className="text-sm font-medium">
          What are you selling?
        </label>
        <Input
          id="listing-intent"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='e.g. "T-shirts", "Home tiffin", "Yoga classes"'
          className="h-12 text-base rounded-2xl"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canContinue) {
              e.preventDefault();
              onContinue();
            }
          }}
        />
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Sparkles size={12} />Describe it in your words — we&apos;ll suggest the category next.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Try an example</p>
        <div className="flex flex-wrap gap-2">
          {INTENT_EXAMPLE_CHIPS.map((chip) => (
            <Badge
              key={chip}
              variant={value === chip ? 'default' : 'secondary'}
              className={cn(
                'cursor-pointer text-xs py-1.5 px-3 rounded-full',
                value === chip && 'ring-2 ring-primary/30',
              )}
              onClick={() => onChange(chip)}
            >
              {chip}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          <ArrowRight size={12} />Next: How buyers get what you offer
        </p>
        <Button className="w-full" onClick={onContinue} disabled={!canContinue}>
          Continue<ChevronRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}
