// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  addDaysIso,
  formatTripWhen,
  type RideDirection,
} from '@/lib/cleaner-city/legInactive';
import { cn } from '@/lib/utils';

export type InactiveDuration =
  | 'this_trip'
  | 'both_today'
  | 'tomorrow'
  | 'this_week'
  | 'longer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  todayIso: string;
  direction: RideDirection;
  leaveTime: string;
  busy?: boolean;
  onConfirm: (duration: InactiveDuration) => void | Promise<void>;
};

export function CleanerCityInactiveRideDrawer({
  open,
  onOpenChange,
  date,
  todayIso,
  direction,
  leaveTime,
  busy,
  onConfirm,
}: Props) {
  const [duration, setDuration] = useState<InactiveDuration>('this_trip');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDuration('this_trip');
  }, [open, direction, date]);

  const thisTripWhen = formatTripWhen(date, leaveTime, todayIso);
  const tomorrowIso = addDaysIso(date, 1);
  const tomorrowWhen = formatTripWhen(tomorrowIso, leaveTime, todayIso);
  const sideLabel = direction === 'to_home' ? 'to home' : 'to office';

  const statusText = useMemo(() => {
    if (duration === 'this_trip') {
      return `You'll be marked inactive for this trip at ${thisTripWhen}.`;
    }
    if (duration === 'both_today') {
      const day =
        date === todayIso
          ? 'today'
          : date === addDaysIso(todayIso, 1)
            ? 'tomorrow'
            : new Intl.DateTimeFormat('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }).format(new Date(`${date}T12:00:00`));
      return `You'll be marked inactive both ways ${day}.`;
    }
    if (duration === 'tomorrow') {
      return `You'll be marked inactive for tomorrow's trip at ${tomorrowWhen}.`;
    }
    if (duration === 'this_week') {
      return `You'll be marked inactive for this ${sideLabel} trip for the rest of the week.`;
    }
    return 'Matching pauses until you turn rides back on from Planned rides.';
  }, [duration, thisTripWhen, tomorrowWhen, date, leaveTime, todayIso, sideLabel]);

  const options: Array<{
    id: InactiveDuration;
    label: string;
    hint?: string;
  }> = [
    {
      id: 'this_trip',
      label: 'Just for this trip',
      hint: `(${thisTripWhen})`,
    },
    {
      id: 'both_today',
      label: 'Both ways today',
      hint: 'Morning and evening',
    },
    {
      id: 'tomorrow',
      label: 'For tomorrow',
      hint: `(${tomorrowWhen})`,
    },
    {
      id: 'this_week',
      label: 'For this week',
    },
    {
      id: 'longer',
      label: 'For longer',
    },
  ];

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm(duration);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        className="max-h-[88vh] rounded-t-[1.35rem] bg-background"
        data-testid="cleaner-city-inactive-ride-drawer"
      >
        <DrawerHeader className="relative px-5 pb-1 pt-1">
          <DrawerTitle className="pr-10 text-center text-[16px] font-extrabold tracking-tight">
            How long do you want to be inactive?
          </DrawerTitle>
          <DrawerClose asChild>
            <button
              type="button"
              className="absolute right-4 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </DrawerClose>
        </DrawerHeader>

        <div className="space-y-4 px-5 pb-2 pt-2">
          <RadioGroup
            value={duration}
            onValueChange={(v) => setDuration(v as InactiveDuration)}
            className="space-y-1"
          >
            {options.map((opt) => (
              <label
                key={opt.id}
                htmlFor={`inactive-${opt.id}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                  duration === opt.id
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-transparent hover:bg-muted/40',
                )}
              >
                <RadioGroupItem
                  id={`inactive-${opt.id}`}
                  value={opt.id}
                  className="mt-0.5"
                  data-testid={`cleaner-city-inactive-option-${opt.id}`}
                />
                <span className="min-w-0 flex-1">
                  <Label
                    htmlFor={`inactive-${opt.id}`}
                    className="cursor-pointer text-[13px] font-semibold text-foreground"
                  >
                    {opt.label}
                  </Label>
                  {opt.hint ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{opt.hint}</p>
                  ) : null}
                </span>
              </label>
            ))}
          </RadioGroup>

          <p
            className="text-[12px] font-semibold leading-snug text-rose-600 dark:text-rose-400"
            data-testid="cleaner-city-inactive-status"
          >
            {statusText}
          </p>
        </div>

        <DrawerFooter className="grid grid-cols-2 gap-2 px-5 pb-5 pt-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl text-[13px] font-bold"
            disabled={saving || busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl text-[13px] font-bold"
            disabled={saving || busy}
            onClick={() => void confirm()}
            data-testid="cleaner-city-inactive-confirm"
          >
            {saving ? 'Saving…' : 'Go inactive'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
