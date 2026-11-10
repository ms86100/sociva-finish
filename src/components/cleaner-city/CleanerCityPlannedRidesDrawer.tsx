// @ts-nocheck
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock, X } from 'lucide-react';
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
import {
  useCommuteTemplates,
  useSetCommuteTemplate,
} from '@/hooks/queries/useCleanerCity';
import { CLEANER_CITY_WEEKDAYS } from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

const WORK_WEEK = [1, 2, 3, 4, 5] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (info: { depart: string; returnTime: string; officeDays: number[] }) => void;
};

function timeToInput(value: string | null | undefined, fallback = '08:30') {
  if (!value) return fallback;
  const raw = String(value).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function formatClock(value: string) {
  const raw = timeToInput(value, '');
  if (!raw) return '--:--';
  const [hRaw, m] = raw.split(':');
  let h = Number(hRaw);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ap}`;
}

function shiftHhmm(value: string, minutesDelta: number) {
  const [h, m] = timeToInput(value).split(':').map(Number);
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

function TimeField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testId: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') el.showPicker();
      else el.focus();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <FieldShell label={label}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          onClick={openPicker}
          data-testid={`${testId}-display`}
        >
          <Clock size={15} className="shrink-0 text-muted-foreground" />
          <span className="text-[18px] font-extrabold tabular-nums leading-none text-foreground">
            {formatClock(value)}
          </span>
        </button>

        <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-muted/35">
          <button
            type="button"
            className="flex h-9 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(shiftHhmm(value, 15))}
            aria-label={`${label} 15 minutes later`}
            data-testid={`${testId}-up`}
          >
            <ChevronUp size={14} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="flex h-9 w-8 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(shiftHhmm(value, -15))}
            aria-label={`${label} 15 minutes earlier`}
            data-testid={`${testId}-down`}
          >
            <ChevronDown size={14} strokeWidth={2.4} />
          </button>
        </div>

        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="time"
          value={value}
          onChange={(e) => {
            if (!e.target.value) return;
            onChange(e.target.value);
          }}
          className="sr-only"
          data-testid={testId}
        />
      </div>
    </FieldShell>
  );
}

/**
 * HOPR-style bottom drawer for weekly planned rides (office days + leave times).
 */
export function CleanerCityPlannedRidesDrawer({ open, onOpenChange, onSaved }: Props) {
  const { data: templates = [] } = useCommuteTemplates();
  const setTemplate = useSetCommuteTemplate();
  const [officeDays, setOfficeDays] = useState(() => new Set<number>([1, 2, 3, 4, 5]));
  const [depart, setDepart] = useState('08:30');
  const [returnTime, setReturnTime] = useState('17:00');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const workRows = WORK_WEEK.map((d) => templates.find((t) => t.weekday === d)).filter(Boolean);
    const on = new Set<number>();
    for (const d of WORK_WEEK) {
      const row = templates.find((t) => t.weekday === d);
      if (!row || row.is_working) on.add(d);
    }
    if (on.size === 0) {
      for (const d of WORK_WEEK) on.add(d);
    }
    setOfficeDays(on);
    const firstOn = workRows.find((r) => r?.is_working) || workRows[0];
    setDepart(timeToInput(firstOn?.depart_time, '08:30'));
    setReturnTime(timeToInput(firstOn?.return_time, '17:00'));
    setDirty(false);
  }, [open, templates]);

  const dayLabels = useMemo(
    () => CLEANER_CITY_WEEKDAYS.filter((d) => WORK_WEEK.includes(d.value as any)),
    [],
  );

  const canSave = dirty && officeDays.size > 0;

  const confirm = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      for (const day of WORK_WEEK) {
        const existing = templates.find((t) => t.weekday === day);
        const isWorking = officeDays.has(day);
        await setTemplate.mutateAsync({
          weekday: day,
          is_working: isWorking,
          depart_time: isWorking ? depart : null,
          return_time: isWorking ? returnTime : null,
          pickup_label: existing?.pickup_label ?? null,
          pickup_latitude: existing?.pickup_latitude ?? null,
          pickup_longitude: existing?.pickup_longitude ?? null,
        });
      }
      for (const day of [6, 0] as const) {
        const existing = templates.find((t) => t.weekday === day);
        await setTemplate.mutateAsync({
          weekday: day,
          is_working: false,
          depart_time: null,
          return_time: null,
          pickup_label: existing?.pickup_label ?? null,
          pickup_latitude: existing?.pickup_latitude ?? null,
          pickup_longitude: existing?.pickup_longitude ?? null,
        });
      }
      toast.success('Planned rides updated');
      onSaved?.({
        depart,
        returnTime,
        officeDays: Array.from(officeDays),
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save planned rides');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        className="max-h-[90vh] rounded-t-[1.35rem] border-border bg-background"
        data-testid="cleaner-city-planned-rides-drawer"
      >
        <DrawerHeader className="relative px-5 pb-2 pt-1">
          <DrawerTitle className="pr-10 text-center text-[16px] font-extrabold tracking-tight">
            Edit planned rides
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

        <div className="max-h-[65vh] space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <FieldShell label="Office days">
            <div className="flex flex-wrap gap-2">
              {dayLabels.map((d) => {
                const on = officeDays.has(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-bold',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground',
                    )}
                    onClick={() => {
                      setOfficeDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.value)) next.delete(d.value);
                        else next.add(d.value);
                        return next;
                      });
                      setDirty(true);
                    }}
                    data-testid={`cleaner-city-planned-day-${d.value}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              On = office. Off = WFH / not commuting that weekday.
            </p>
          </FieldShell>

          <TimeField
            label="Leave home"
            value={depart}
            onChange={(next) => {
              setDepart(next);
              setDirty(true);
            }}
            testId="cleaner-city-planned-depart"
          />

          <TimeField
            label="Leave office"
            value={returnTime}
            onChange={(next) => {
              setReturnTime(next);
              setDirty(true);
            }}
            testId="cleaner-city-planned-return"
          />
        </div>

        <DrawerFooter className="px-5 pb-5 pt-2">
          <Button
            type="button"
            className={cn(
              'h-11 w-full rounded-xl text-[14px] font-bold',
              !canSave &&
                'bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100',
            )}
            disabled={!canSave || saving}
            onClick={() => void confirm()}
            data-testid="cleaner-city-planned-rides-confirm"
          >
            {saving ? 'Saving…' : 'Confirm changes'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
