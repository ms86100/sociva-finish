// @ts-nocheck
import {
  RIDE_MISSION_STEPS,
  rideNextHint,
  rideStepTitle,
  stepIndex,
  type RideMissionStep,
} from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

type Props = {
  status: string;
  isHost: boolean;
};

export function RideStatusStepper({ status, isHost }: Props) {
  const known = RIDE_MISSION_STEPS.includes(status as RideMissionStep);
  const terminalSpecial = ['disputed', 'safety_incident', 'no_show', 'cancelled', 'rejected'].includes(
    status,
  );

  if (terminalSpecial && !known) {
    return (
      <section
        className="rounded-2xl border border-border bg-card p-4 space-y-2"
        data-testid="cleaner-city-ride-stepper"
      >
        <p className="text-sm font-semibold">
          {status === 'disputed'
            ? 'Under admin review'
            : status === 'safety_incident'
              ? 'SOS active'
              : status === 'no_show'
                ? 'Marked no-show'
                : status === 'cancelled'
                  ? 'Cancelled'
                  : 'Ended'}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {rideNextHint(status, isHost)}
        </p>
      </section>
    );
  }

  const current = stepIndex(status);

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      data-testid="cleaner-city-ride-stepper"
    >
      <div className="flex items-center justify-between gap-2">
        {RIDE_MISSION_STEPS.map((step, i) => {
          const done = known && i < current;
          const active = known && i === current;
          return (
            <div key={step} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-extrabold transition-all duration-300',
                  done && 'bg-primary text-primary-foreground',
                  active && 'bg-primary/15 text-primary ring-2 ring-primary scale-110',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? '✓' : i + 1}
              </div>
              <p
                className={cn(
                  'truncate text-[10px] font-semibold',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {rideStepTitle(step)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {rideNextHint(status, isHost)}
      </p>
    </section>
  );
}
