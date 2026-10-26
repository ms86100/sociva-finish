import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListingClosedStripModel } from '@/lib/listing-closed-strip';

interface ListingClosedStripProps {
  model: ListingClosedStripModel;
  className?: string;
}

/** Full-width closed status - never truncates the reopen time. */
export function ListingClosedStrip({ model, className }: ListingClosedStripProps) {
  return (
    <div
      data-testid="listing-closed-strip"
      className={cn(
        'mb-3 flex items-stretch gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] px-3.5 py-3',
        className,
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card/90 text-amber-700 shadow-sm border border-amber-500/20">
        <Clock size={15} strokeWidth={2.4} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug text-foreground">{model.message}</p>
        <p className="mt-0.5 text-[11px] font-medium leading-snug text-muted-foreground">{model.hint}</p>
      </div>
      <span className="self-center shrink-0 rounded-xl bg-primary px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-primary-foreground">
        Schedule
      </span>
    </div>
  );
}
