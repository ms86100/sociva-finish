import { Link } from 'react-router-dom';
import { MapPinned, Route } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  variant: 'guest' | 'host';
  hasPins?: boolean;
  hasRoads?: boolean;
  className?: string;
};

/**
 * Persistent reminder that corridor/route selection powers matching for both sides.
 */
export function CleanerCityRouteBanner({ variant, hasPins, hasRoads, className }: Props) {
  const ready = variant === 'guest' ? !!hasPins : !!(hasPins && hasRoads);
  const title =
    variant === 'guest'
      ? ready
        ? 'Your corridor is set'
        : 'Pin your office and pickup'
      : ready
        ? 'Your driving roads are saved'
        : 'Save the roads you actually drive';
  const detail =
    variant === 'guest'
      ? ready
        ? 'Find matches hosts whose roads pass your gate - not just the same society name.'
        : 'Without pins, Find cannot place you on a real road corridor.'
      : ready
        ? 'Guests only see you when their seat shares your published polyline.'
        : 'Offer seats only after you pick morning and evening roads on the map.';

  return (
    <Link
      to="/cleaner-city/route"
      className={cn(
        'relative block overflow-hidden rounded-2xl border p-4 shadow-sm transition hover:border-emerald-700/30',
        ready
          ? 'border-emerald-800/15 bg-gradient-to-br from-emerald-50 via-white to-teal-50/40'
          : 'border-amber-500/25 bg-gradient-to-br from-amber-50 via-white to-orange-50/30',
        className,
      )}
      data-testid="cleaner-city-route-banner"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-emerald-600/10 blur-2xl"
      />
      <div className="relative flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            ready ? 'bg-emerald-800 text-white' : 'bg-amber-100 text-amber-900',
          )}
        >
          {variant === 'host' ? <Route className="h-5 w-5" /> : <MapPinned className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          <p className="mt-2 text-xs font-semibold text-emerald-900">
            {ready ? 'Review or change route →' : 'Open route setup →'}
          </p>
        </div>
      </div>
    </Link>
  );
}
