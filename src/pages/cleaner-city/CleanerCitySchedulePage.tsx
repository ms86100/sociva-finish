// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  useCleanerCityProfile,
  useCommuteTemplates,
  useMaybeEnableDefaultAutopilot,
  useOfficeLocations,
  useSetAutopilot,
  useSetCommuteTemplate,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_WEEKDAYS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

const WORK_WEEK = [1, 2, 3, 4, 5] as const;

function timeToInput(value: string | null | undefined, fallback = '08:30') {
  if (!value) return fallback;
  return String(value).slice(0, 5);
}

type DayDraft = {
  is_working: boolean;
  depart_time: string;
  return_time: string;
};

const emptyDay = (): DayDraft => ({
  is_working: true,
  depart_time: '08:30',
  return_time: '19:00',
});

export default function CleanerCitySchedulePage() {
  const { data: profile } = useCleanerCityProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const arrivalState = (location.state as { notice?: string; from?: string } | null) || {};
  const arrivalNotice = arrivalState.notice || '';
  const backTo =
    typeof arrivalState.from === 'string' && arrivalState.from.startsWith('/cleaner-city')
      ? arrivalState.from
      : '/cleaner-city/route';

  const { data: templates = [] } = useCommuteTemplates();
  const { data: offices = [] } = useOfficeLocations();
  const setTemplate = useSetCommuteTemplate();
  const setAutopilot = useSetAutopilot();
  const maybeEnableAutopilot = useMaybeEnableDefaultAutopilot();

  const [days, setDays] = useState<Record<number, DayDraft>>({});
  const [depart, setDepart] = useState('08:30');
  const [returnTime, setReturnTime] = useState('19:00');
  const [editingLeg, setEditingLeg] = useState<'to_office' | 'to_home' | null>(null);
  const [saving, setSaving] = useState(false);

  const primaryOffice = offices.find((o) => o.is_primary) || offices[0] || null;
  const homeLabel = useMemo(() => {
    const withPin = templates.find(
      (t) =>
        typeof t.pickup_latitude === 'number' &&
        Number.isFinite(t.pickup_latitude),
    );
    return withPin?.pickup_label || 'Home';
  }, [templates]);
  const officeLabel =
    primaryOffice?.label || primaryOffice?.address_text || 'Office';

  useEffect(() => {
    const next: Record<number, DayDraft> = {};
    for (const wd of CLEANER_CITY_WEEKDAYS) {
      const row = templates.find((t) => t.weekday === wd.value);
      next[wd.value] = row
        ? {
            is_working: row.is_working,
            depart_time: timeToInput(row.depart_time, '08:30'),
            return_time: timeToInput(row.return_time, '19:00'),
          }
        : {
            ...emptyDay(),
            is_working: wd.value >= 1 && wd.value <= 5,
          };
    }
    setDays(next);

    const firstWorking =
      WORK_WEEK.map((d) => templates.find((t) => t.weekday === d)).find((r) => r?.is_working) ||
      templates.find((t) => WORK_WEEK.includes(t.weekday as (typeof WORK_WEEK)[number]));
    setDepart(timeToInput(firstWorking?.depart_time, '08:30'));
    setReturnTime(timeToInput(firstWorking?.return_time, '19:00'));
  }, [templates]);

  const workingDays = useMemo(
    () => CLEANER_CITY_WEEKDAYS.filter((wd) => days[wd.value]?.is_working),
    [days],
  );

  if (!profile) {
    return (
      <CleanerCityChrome headerTitle="Leave times" backTo={backTo} backLabel="Back">
        <CleanerCityGate>
          <div className={cn(cc.page, 'pb-8')} data-testid="cleaner-city-schedule-missing-profile">
            <p className="text-sm text-muted-foreground">
              Finish setup first, then set your leave times.
            </p>
            <Link to="/cleaner-city/setup" className={cn('text-sm font-semibold', cc.forestText)}>
              Go to setup
            </Link>
          </div>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  const pickupFieldsFor = (weekday: number) => {
    const row = templates.find((t) => t.weekday === weekday);
    return {
      pickup_label: row?.pickup_label ?? null,
      pickup_latitude: row?.pickup_latitude ?? null,
      pickup_longitude: row?.pickup_longitude ?? null,
    };
  };

  const toggleDayWorking = (weekday: number) => {
    setDays((prev) => {
      const draft = prev[weekday] || emptyDay();
      return {
        ...prev,
        [weekday]: { ...draft, is_working: !draft.is_working },
      };
    });
  };

  const saveCommute = async () => {
    if (!depart || !returnTime) {
      toast.error('Set both leave times');
      return;
    }
    const onDays = CLEANER_CITY_WEEKDAYS.filter((wd) => days[wd.value]?.is_working);
    if (onDays.length === 0) {
      toast.error('Keep at least one commute day');
      return;
    }
    setSaving(true);
    try {
      for (const wd of CLEANER_CITY_WEEKDAYS) {
        const draft = days[wd.value] || emptyDay();
        const isWorking = !!draft.is_working;
        await setTemplate.mutateAsync({
          weekday: wd.value,
          is_working: isWorking,
          depart_time: isWorking ? depart : null,
          return_time: isWorking ? returnTime : null,
          ...pickupFieldsFor(wd.value),
        });
      }
      toast.success('Commute saved');
      try {
        await maybeEnableAutopilot.mutateAsync();
      } catch {
        // Non-blocking: leave times are saved even if Auto-offer default fails.
      }
      navigate('/cleaner-city', { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Could not save commute');
    } finally {
      setSaving(false);
    }
  };

  const toggleAutopilot = async (enabled: boolean) => {
    try {
      await setAutopilot.mutateAsync({
        enabled,
        confirm_mode: enabled
          ? profile.autopilot_confirm_mode || 'auto'
          : profile.autopilot_confirm_mode || 'auto',
      });
      toast.success(enabled ? 'Auto-offer turned on' : 'Auto-offer turned off');
    } catch (e: any) {
      toast.error(e?.message || 'Could not update auto-offer');
    }
  };

  return (
    <CleanerCityChrome headerTitle="Leave times" backTo={backTo} backLabel="Back">
      <CleanerCityGate>
        <div
          className={cn(cc.page, 'pb-8')}
          data-testid="cleaner-city-schedule"
        >
          <p className="text-[14px] text-muted-foreground">
            Set when you usually leave. Auto-offer uses these times so neighbours can find you on your usual road.
          </p>

          {arrivalNotice ? (
            <div
              className="rounded-2xl border border-[#0F3D2E]/20 bg-[#E8F2EC] px-4 py-3 text-sm leading-relaxed text-[#0F3D2E]"
              data-testid="cleaner-city-schedule-notice"
            >
              {arrivalNotice}
            </div>
          ) : null}

          <section className={cn(cc.card, 'p-4')} data-testid="schedule-day-chips">
            <p className={cc.sectionLabel}>Weekdays</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CLEANER_CITY_WEEKDAYS.map((wd) => {
                const draft = days[wd.value] || emptyDay();
                const on = draft.is_working;
                return (
                  <button
                    key={wd.value}
                    type="button"
                    onClick={() => toggleDayWorking(wd.value)}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full border text-[12px] font-semibold transition',
                      on
                        ? 'border-[#0F3D2E] bg-[#0F3D2E] text-white'
                        : 'border-black/10 bg-white text-muted-foreground',
                    )}
                    data-testid={`schedule-weekday-${wd.value}`}
                    aria-pressed={on}
                  >
                    {wd.label.slice(0, 1)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {workingDays.length > 0
                ? `Commuting ${workingDays.map((d) => d.label).join(', ')}`
                : 'Tap days you commute'}
            </p>
          </section>

          <section className={cn(cc.card, 'p-4')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-foreground">To office</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Leave</p>
                <p className="mt-1 text-[28px] font-bold tracking-tight text-foreground">
                  {depart}
                </p>
              </div>
              <button
                type="button"
                className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', cc.forestText)}
                onClick={() =>
                  setEditingLeg((prev) => (prev === 'to_office' ? null : 'to_office'))
                }
                data-testid="schedule-edit-to-office"
              >
                Edit
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {editingLeg === 'to_office' ? (
              <Input
                type="time"
                value={depart}
                onChange={(e) => setDepart(e.target.value)}
                className="mt-3 h-11"
                data-testid="schedule-depart-input"
              />
            ) : null}
            <p className="mt-2 text-[12px] text-muted-foreground">
              {homeLabel} to {officeLabel}
            </p>
          </section>

          <section className={cn(cc.card, 'p-4')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-foreground">To home</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Leave</p>
                <p className="mt-1 text-[28px] font-bold tracking-tight text-foreground">
                  {returnTime}
                </p>
              </div>
              <button
                type="button"
                className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', cc.forestText)}
                onClick={() =>
                  setEditingLeg((prev) => (prev === 'to_home' ? null : 'to_home'))
                }
                data-testid="schedule-edit-to-home"
              >
                Edit
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {editingLeg === 'to_home' ? (
              <Input
                type="time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
                className="mt-3 h-11"
                data-testid="schedule-return-input"
              />
            ) : null}
            <p className="mt-2 text-[12px] text-muted-foreground">
              Office to Home
            </p>
          </section>

          <section
            className={cn(cc.card, 'flex items-center justify-between gap-3 p-4')}
            data-testid="cleaner-city-autopilot-section"
          >
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-foreground">
                Auto-offer seats on weekdays
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {profile.autopilot_enabled
                  ? 'Neighbours can find you on your usual road. Pause commute or mark a day off to stop.'
                  : 'Turn on so neighbours can find you on commute days without publishing each day.'}
              </p>
            </div>
            <Switch
              checked={!!profile.autopilot_enabled}
              onCheckedChange={toggleAutopilot}
              disabled={setAutopilot.isPending}
              data-testid="cleaner-city-autopilot-toggle"
            />
          </section>

          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            onClick={saveCommute}
            disabled={saving || setTemplate.isPending}
            data-testid="schedule-save-work-week"
          >
            {saving || setTemplate.isPending ? 'Saving...' : 'Save commute'}
          </button>

          <div className="flex flex-col items-center gap-2 text-center">
            <Link
              to="/cleaner-city/route"
              className={cn('text-[13px] font-semibold', cc.forestText)}
            >
              Edit home and office
            </Link>
            <p className="text-[11px] text-muted-foreground">
              Timezone {profile.timezone || DEFAULT_COMMUTE_TIMEZONE}
            </p>
          </div>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
