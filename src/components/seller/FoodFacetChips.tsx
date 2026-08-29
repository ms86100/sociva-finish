import { Label } from '@/components/ui/label';
import {
  FOOD_COURSES,
  FOOD_CUISINES,
  FOOD_MEALS,
  type FoodFacets,
} from '@/lib/food-facets';
import { cn } from '@/lib/utils';

interface FoodFacetChipsProps {
  value: FoodFacets;
  onChange: (next: FoodFacets) => void;
}

function ChipRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  selected: T | null;
  onSelect: (id: T | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(active ? null : opt.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FoodFacetChips({ value, onChange }: FoodFacetChipsProps) {
  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">
        Optional filters for buyers. These do not create a new category.
      </p>
      <ChipRow
        label="Cuisine"
        options={FOOD_CUISINES}
        selected={value.cuisine}
        onSelect={(cuisine) => onChange({ ...value, cuisine })}
      />
      <ChipRow
        label="Meal"
        options={FOOD_MEALS}
        selected={value.meal}
        onSelect={(meal) => onChange({ ...value, meal })}
      />
      <ChipRow
        label="Course"
        options={FOOD_COURSES}
        selected={value.course}
        onSelect={(course) => onChange({ ...value, course })}
      />
    </div>
  );
}
