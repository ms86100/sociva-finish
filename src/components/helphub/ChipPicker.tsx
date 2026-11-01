// @ts-nocheck
import { cn } from '@/lib/utils';

interface ChipOption {
  value: string;
  label: string;
}

interface ChipPickerProps {
  options: ChipOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ChipPicker({ options, value, onChange, className }: ChipPickerProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground border-border hover:border-primary/40',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
