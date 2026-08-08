import { Store } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function SellerDashboardLoadingState({ storeName }: { storeName?: string }) {
  return (
    <div
      className="p-4 space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={storeName ? `Switching to ${storeName}` : 'Loading seller dashboard'}
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Store size={18} className="text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Switching store</p>
          <p className="truncate text-sm font-semibold text-foreground">
            {storeName || 'Loading seller dashboard'}
          </p>
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
