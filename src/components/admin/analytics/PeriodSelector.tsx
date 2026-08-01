// @ts-nocheck
import { Button } from '@/components/ui/button';
import { PeriodFilter } from '@/hooks/queries/useAdminAnalytics';
import { cn } from '@/lib/utils';

const PERIODS: { value: PeriodFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'all', label: 'All Time' },
];

export function PeriodSelector({ value, onChange }: { value: PeriodFilter; onChange: (v: PeriodFilter) => void }) {
  return (
    <div className="flex gap-1 bg-muted/50 p-1 rounded-xl">
      {PERIODS.map(p => (
        <Button
          key={p.value}
          size="sm"
          variant={value === p.value ? 'default' : 'ghost'}
          className={cn('h-7 text-[11px] px-3 rounded-lg font-semibold', value !== p.value && 'text-muted-foreground')}
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
