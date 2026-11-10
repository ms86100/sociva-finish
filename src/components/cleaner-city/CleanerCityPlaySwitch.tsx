import { Link, useNavigate } from 'react-router-dom';
import { Car, MapPinned, Users } from 'lucide-react';
import { setCleanerCityIntent } from '@/lib/cleaner-city/intent';
import { cn } from '@/lib/utils';

type Props = {
  mode: 'find' | 'offer';
  hasPins?: boolean;
  hasRoads?: boolean;
  className?: string;
  /**
   * When set, switching roles stays on the current Home board and only updates intent.
   * Offer tools remain available via the corridor chip / Offer page links.
   */
  onModeChange?: (mode: 'find' | 'offer') => void;
};

/**
 * Play mode switch: Find a seat (guest) | Offer seats (host).
 * Same Home board; CTA becomes Find Hosts or Find Guests.
 */
export function CleanerCityPlaySwitch({
  mode,
  hasPins,
  hasRoads,
  className,
  onModeChange,
}: Props) {
  const navigate = useNavigate();
  const corridorReady =
    mode === 'find' ? !!hasPins : !!(hasPins && hasRoads);

  const go = (next: 'find' | 'offer') => {
    setCleanerCityIntent(next === 'offer' ? 'host' : 'guest');
    if (onModeChange) {
      onModeChange(next);
      return;
    }
    navigate(next === 'offer' ? '/cleaner-city/offer' : '/cleaner-city');
  };

  return (
    <div className={cn('space-y-2', className)} data-testid="cleaner-city-play-switch">
      <div
        className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1"
        role="tablist"
        aria-label="Find a seat or offer seats"
      >
        {(
          [
            { id: 'find' as const, label: 'Find a seat', icon: Users },
            { id: 'offer' as const, label: 'Offer seats', icon: Car },
          ]
        ).map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition',
                active
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                  : 'text-foreground/70 hover:text-foreground',
              )}
              onClick={() => go(tab.id)}
              data-testid={`cleaner-city-play-${tab.id}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <Link
        to="/cleaner-city/route"
        className={cn(
          'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition',
          corridorReady
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-50'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-50',
        )}
        data-testid="cleaner-city-play-corridor-chip"
      >
        <MapPinned className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {corridorReady
            ? mode === 'find'
              ? 'Home and office set'
              : 'Home, office, and roads set'
            : mode === 'find'
              ? 'Add home and office to match'
              : 'Add home, office, and roads to offer'}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-70">
          Edit
        </span>
      </Link>
    </div>
  );
}
