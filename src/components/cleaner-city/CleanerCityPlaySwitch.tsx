import { Link, useNavigate } from 'react-router-dom';
import { Car, MapPinned, Users } from 'lucide-react';
import { setCleanerCityIntent } from '@/lib/cleaner-city/intent';
import { cn } from '@/lib/utils';

type Props = {
  mode: 'find' | 'offer';
  hasPins?: boolean;
  hasRoads?: boolean;
  className?: string;
};

/**
 * Play mode switch: Find a seat | Offer seats.
 * Corridor chip soft-gates incomplete route setup without burying Route.
 */
export function CleanerCityPlaySwitch({ mode, hasPins, hasRoads, className }: Props) {
  const navigate = useNavigate();
  const corridorReady =
    mode === 'find' ? !!hasPins : !!(hasPins && hasRoads);

  const go = (next: 'find' | 'offer') => {
    setCleanerCityIntent(next === 'offer' ? 'host' : 'guest');
    navigate(next === 'offer' ? '/cleaner-city/offer' : '/cleaner-city/find');
  };

  return (
    <div className={cn('space-y-2', className)} data-testid="cleaner-city-play-switch">
      <div
        className="grid grid-cols-2 gap-1 rounded-2xl border border-emerald-900/10 bg-muted/40 p-1"
        role="tablist"
        aria-label="Play mode"
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
                'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                active
                  ? 'bg-background text-emerald-950 shadow-sm'
                  : 'text-muted-foreground',
              )}
              onClick={() => go(tab.id)}
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
            ? 'border-emerald-800/15 bg-emerald-50/60 text-emerald-950'
            : 'border-amber-500/25 bg-amber-50/70 text-amber-950',
        )}
        data-testid="cleaner-city-play-corridor-chip"
      >
        <MapPinned className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {corridorReady
            ? mode === 'find'
              ? 'Corridor unlocked - matching on your pins'
              : 'Corridor unlocked - publishing on your roads'
            : mode === 'find'
              ? 'Unlock Route - pin office and pickup to match'
              : 'Unlock Route - save pins and roads to publish'}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-70">
          {corridorReady ? 'Route' : 'Unlock'}
        </span>
      </Link>
    </div>
  );
}
