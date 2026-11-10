// @ts-nocheck
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDownUp, ChevronDown, ChevronUp, Clock, MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useSetCommuteOverride } from '@/hooks/queries/useCleanerCity';
import {
  encodeInactiveNote,
  parseInactiveLegs,
  withLegInactive,
} from '@/lib/cleaner-city/legInactive';
import { cn } from '@/lib/utils';

type Direction = 'to_office' | 'to_home';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  direction: Direction;
  homeLabel: string;
  officeLabel: string;
  departTime: string;
  returnTime: string;
  isWorking?: boolean;
  note?: string | null;
  /** Called after a successful save so callers can refresh local search state. */
  onConfirmed?: (next: { direction: Direction; leaveTime: string }) => void;
  /** Opens Change route drawer for this leg (preferred over navigating to Route page). */
  onRequestChangeRoute?: (direction: Direction) => void;
  title?: string;
};

function normalizeHhmm(value?: string | null, fallback = '08:30') {
  const raw = String(value || '').slice(0, 5);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function formatLeave(value?: string | null) {
  const raw = normalizeHhmm(value, '');
  if (!raw) return '--:--';
  const [hRaw, m] = raw.split(':');
  let h = Number(hRaw);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

function shiftHhmm(value: string, minutesDelta: number) {
  const [h, m] = normalizeHhmm(value).split(':').map(Number);
  let total = ((h || 0) * 60 + (m || 0) + minutesDelta + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function FieldShell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-border bg-card px-3 pb-2.5 pt-3.5',
        className,
      )}
    >
      <span className="absolute -top-2 left-3 z-[1] bg-background px-1 text-[10px] font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * HOPR-style bottom drawer to edit one leave-time without leaving the current screen.
 */
export function CleanerCityEditRideDrawer({
  open,
  onOpenChange,
  date,
  direction,
  homeLabel,
  officeLabel,
  departTime,
  returnTime,
  isWorking = true,
  note = null,
  onConfirmed,
  onRequestChangeRoute,
  title = 'Edit this ride',
}: Props) {
  const setOverride = useSetCommuteOverride();
  const timeInputId = useId();
  const timeInputRef = useRef<HTMLInputElement | null>(null);
  const [dir, setDir] = useState<Direction>(direction);
  const [leave, setLeave] = useState(
    normalizeHhmm(direction === 'to_home' ? returnTime : departTime),
  );
  const [departKeep, setDepartKeep] = useState(normalizeHhmm(departTime));
  const [returnKeep, setReturnKeep] = useState(normalizeHhmm(returnTime, '18:30'));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextDepart = normalizeHhmm(departTime);
    const nextReturn = normalizeHhmm(returnTime, '18:30');
    setDir(direction);
    setDepartKeep(nextDepart);
    setReturnKeep(nextReturn);
    setLeave(direction === 'to_home' ? nextReturn : nextDepart);
    setDirty(false);
  }, [open, direction, departTime, returnTime]);

  const start = dir === 'to_office' ? homeLabel : officeLabel;
  const end = dir === 'to_office' ? officeLabel : homeLabel;
  const baselineLeave = normalizeHhmm(
    direction === 'to_home' ? returnTime : departTime,
  );
  const canSave =
    dirty || dir !== direction || leave !== baselineLeave;

  const setLeaveValue = (next: string) => {
    const normalized = normalizeHhmm(next, leave);
    setLeave(normalized);
    if (dir === 'to_office') setDepartKeep(normalized);
    else setReturnKeep(normalized);
    setDirty(true);
  };

  const swap = () => {
    setDir((d) => {
      const next = d === 'to_office' ? 'to_home' : 'to_office';
      setLeave(next === 'to_home' ? returnKeep : departKeep);
      return next;
    });
    setDirty(true);
  };

  const openTimePicker = () => {
    const el = timeInputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') el.showPicker();
      else el.focus();
    } catch {
      el.focus();
      el.click();
    }
  };

  const confirm = async () => {
    if (!canSave || saving) return;
    if (!/^\d{2}:\d{2}$/.test(leave)) {
      toast.error('Pick a valid leave time');
      return;
    }
    setSaving(true);
    try {
      const nextDepart = dir === 'to_office' ? leave : departKeep;
      const nextReturn = dir === 'to_home' ? leave : returnKeep;
      // Editing a ride means that leg is Going again.
      const inactive = parseInactiveLegs({
        is_working: true,
        note,
      });
      const cleared = withLegInactive(inactive, dir, false);
      const nextNote = encodeInactiveNote(cleared, note);

      await setOverride.mutateAsync({
        override_date: date,
        is_working: true,
        depart_time: nextDepart,
        return_time: nextReturn,
        override_kind: 'time_change',
        note: nextNote,
      });
      toast.success('Ride updated');
      onConfirmed?.({ direction: dir, leaveTime: leave });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        className="max-h-[88vh] rounded-t-[1.35rem] border-border bg-background"
        data-testid="cleaner-city-edit-ride-drawer"
      >
        <DrawerHeader className="relative px-5 pb-2 pt-1 text-left">
          <DrawerTitle className="pr-10 text-center text-[16px] font-extrabold tracking-tight">
            {title}
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

        <div className="space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <div className="relative space-y-3 pr-1">
            <FieldShell label="Start Point" className="pr-12">
              <span className="flex min-h-[28px] items-center gap-2">
                <MapPin size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                  {start || 'Home'}
                </span>
              </span>
            </FieldShell>

            <button
              type="button"
              onClick={swap}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background shadow-sm"
              aria-label="Swap start and end"
              data-testid="cleaner-city-edit-ride-swap"
            >
              <ArrowDownUp size={15} className="text-primary" />
            </button>

            <FieldShell label="End Point" className="pr-12">
              <span className="flex min-h-[28px] items-center gap-2">
                <MapPin size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                  {end || 'Office'}
                </span>
              </span>
            </FieldShell>
          </div>

          <FieldShell label="Choose time">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                onClick={openTimePicker}
                data-testid="cleaner-city-edit-ride-time-display"
              >
                <Clock size={15} className="shrink-0 text-muted-foreground" />
                <span className="text-[18px] font-extrabold tabular-nums leading-none text-foreground">
                  {formatLeave(leave)}
                </span>
              </button>

              <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-muted/35">
                <button
                  type="button"
                  className="flex h-9 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setLeaveValue(shiftHhmm(leave, 15))}
                  aria-label="Leave 15 minutes later"
                  data-testid="cleaner-city-edit-ride-time-up"
                >
                  <ChevronUp size={14} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-8 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setLeaveValue(shiftHhmm(leave, -15))}
                  aria-label="Leave 15 minutes earlier"
                  data-testid="cleaner-city-edit-ride-time-down"
                >
                  <ChevronDown size={14} strokeWidth={2.4} />
                </button>
              </div>

              {/* Single native picker control - visually hidden, opened by the display button. */}
              <label htmlFor={timeInputId} className="sr-only">
                Leave time
              </label>
              <input
                ref={timeInputRef}
                id={timeInputId}
                type="time"
                value={leave}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setLeaveValue(e.target.value);
                }}
                className="sr-only"
                data-testid="cleaner-city-edit-ride-time"
              />
            </div>
          </FieldShell>

          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-muted/35 px-3 py-3 text-left"
            onClick={() => {
              onOpenChange(false);
              onRequestChangeRoute?.(dir);
            }}
            data-testid="cleaner-city-edit-ride-route"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-semibold leading-snug text-foreground">
                Going on a different route?
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-primary">
                Change your preferred route →
              </p>
            </div>
            <span
              aria-hidden
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <MapPin size={18} />
            </span>
          </button>
        </div>

        <DrawerFooter className="px-5 pt-2 pb-5">
          <Button
            type="button"
            className={cn(
              'h-11 w-full rounded-xl text-[14px] font-bold',
              !canSave &&
                'bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100',
            )}
            disabled={!canSave || saving}
            onClick={() => void confirm()}
            data-testid="cleaner-city-edit-ride-confirm"
          >
            {saving ? 'Saving…' : 'Confirm changes'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
