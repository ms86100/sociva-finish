// @ts-nocheck
import {
  RIDE_VISIBLE_STEPS,
  rideVisibleStepTitle,
  visibleStepIndex,
  type RideVisibleStep,
} from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

type Props = {
  status: string;
  isHost?: boolean;
};

export function RideStatusStepper({ status }: Props) {
  const known = (RIDE_VISIBLE_STEPS as readonly string[]).includes(status) || status === 'requested';
  const terminalSpecial = ['disputed', 'safety_incident', 'no_show', 'cancelled', 'rejected'].includes(
    status,
  );

  if (terminalSpecial && !known) {
    return (
      <section
        className="rounded-2xl border border-border bg-card px-4 py-3"
        data-testid="cleaner-city-ride-stepper"
      >
        <p className="text-sm font-semibold">
          {status === 'disputed'
            ? 'Under review'
            : status === 'safety_incident'
              ? 'SOS active'
              : status === 'no_show'
                ? 'No-show'
                : status === 'cancelled'
                  ? 'Cancelled'
                  : 'Ended'}
        </p>
      </section>
    );
  }

  const current = visibleStepIndex(status);

  return (
    <section
      className="rounded-2xl border border-emerald-900/10 bg-white/80 px-2 py-3 shadow-sm backdrop-blur-sm"
      data-testid="cleaner-city-ride-stepper"
      aria-label="Ride progress"
    >
      <div className="grid grid-cols-4 gap-1">
        {RIDE_VISIBLE_STEPS.map((step: RideVisibleStep, i) => {
          const done = known && i < current;
          const active = known && i === current;
          return (
            <div key={step} className="flex min-w-0 flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-extrabold transition-all duration-300',
                  done && 'bg-emerald-800 text-white',
                  active && 'bg-emerald-800 text-white ring-4 ring-emerald-800/15',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? '✓' : i + 1}
              </div>
              <p
                className={cn(
                  'w-full truncate text-center text-[10px] font-semibold',
                  active ? 'text-emerald-900 dark:text-emerald-300' : 'text-muted-foreground',
                )}
              >
                {rideVisibleStepTitle(step)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
