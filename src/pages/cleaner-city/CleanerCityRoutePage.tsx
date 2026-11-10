// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Car, ChevronRight, MapPinned, Route } from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import {
  preferredRouteFromProfile,
  useCleanerCityProfile,
  useCommuteTemplates,
  useOfficeLocations,
} from '@/hooks/queries/useCleanerCity';
import { cn } from '@/lib/utils';

type EditFocus = 'home' | 'office' | 'roads';

function roadLine(
  route: { summary?: string; durationSeconds?: number } | null,
  fallback: string,
) {
  if (!route) return fallback;
  const mins = Math.max(1, Math.round(Number(route.durationSeconds || 0) / 60));
  const summary = String(route.summary || '').trim() || 'Usual road';
  const via = /^via\s+/i.test(summary) ? summary : `via ${summary}`;
  return `${via}, ~${mins} min`;
}

/**
 * Commute path: summary when ready, setup wizard when incomplete or editing.
 */
export default function CleanerCityRoutePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalState = (location.state as {
    notice?: string;
    initialStep?: EditFocus;
  } | null) || {};
  const arrivalNotice = arrivalState.notice || '';
  const arrivalStep =
    arrivalState.initialStep === 'home' ||
    arrivalState.initialStep === 'office' ||
    arrivalState.initialStep === 'roads'
      ? arrivalState.initialStep
      : null;
  const [editFocus, setEditFocus] = useState<EditFocus | null>(arrivalStep);
  const [panelKey, setPanelKey] = useState(0);

  const primaryOffice =
    offices.find((o) => o.is_primary) || offices[0] || null;
  const hasOfficePin = !!(
    primaryOffice &&
    Number.isFinite(Number(primaryOffice.latitude)) &&
    Number.isFinite(Number(primaryOffice.longitude))
  );
  const homeTemplate = useMemo(
    () =>
      templates.find(
        (t) =>
          Number.isFinite(Number(t.pickup_latitude)) &&
          Number.isFinite(Number(t.pickup_longitude)),
      ) || null,
    [templates],
  );
  const hasHomePin = !!homeTemplate;
  const hasPins = hasOfficePin && hasHomePin;
  const toOffice = preferredRouteFromProfile(profile, 'to_office');
  const toHome = preferredRouteFromProfile(profile, 'to_home');
  const hasToOffice = !!toOffice;
  const hasToHome = !!toHome;
  const unlocked = hasPins && hasToOffice && hasToHome;
  const showSummary = unlocked && !editFocus;

  const homeLabel =
    homeTemplate?.pickup_label || 'Home pin not set';
  const officeLabel =
    primaryOffice?.label ||
    primaryOffice?.address_text ||
    'Office pin not set';

  const goLeaveTimes = () => {
    navigate('/cleaner-city/schedule', {
      replace: true,
      state: { from: '/cleaner-city/route' },
    });
  };

  const openEdit = (focus: EditFocus) => {
    setEditFocus(focus);
    setPanelKey((k) => k + 1);
  };

  if (!profile) {
    return (
      <CleanerCityChrome headerTitle="Commute" backTo="/cleaner-city/profile" backLabel="Back">
        <CleanerCityGate>
          <div className={cn(cc.page, 'pb-8')}>
            <p className={cn(cc.meta, 'text-[13px]')}>
              Complete{' '}
              <Link to="/cleaner-city/setup" className={cn('font-semibold', cc.forestText)}>
                setup
              </Link>{' '}
              first.
            </p>
          </div>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  const nextHint = !hasPins
    ? 'Start with home, then office.'
    : !hasToOffice
      ? 'Next: pick the road you take to office.'
      : !hasToHome
        ? 'Next: pick the road you take home.'
        : null;

  return (
    <CleanerCityChrome
      headerTitle={showSummary ? 'Commute' : editFocus === 'roads' ? 'Choose road' : 'Commute'}
    >
      <CleanerCityGate>
        <div
          className={cn(cc.page, 'pb-8')}
          data-testid="cleaner-city-route-page"
        >
          {showSummary ? (
            <>
              <div className="space-y-1">
                <h1 className="text-[22px] font-bold tracking-tight text-foreground">
                  Path ready
                </h1>
                <p className="text-[14px] leading-relaxed text-muted-foreground">
                  Home, office, and both roads are set. Matching uses this path.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { label: 'Home & office', done: hasPins, icon: MapPinned },
                    { label: 'To office', done: hasToOffice, icon: Route },
                    { label: 'To home', done: hasToHome, icon: Car },
                  ] as const
                ).map((step) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={step.label}
                      className={cn(
                        'rounded-2xl border px-2.5 py-2.5',
                        step.done
                          ? 'border-[#0F3D2E]/25 bg-[#E8F2EC]'
                          : 'border-black/10 bg-white',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5',
                          step.done ? cc.forestText : 'text-muted-foreground',
                        )}
                      />
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                        {step.label}
                      </p>
                      <p
                        className={cn(
                          'text-xs font-semibold',
                          step.done ? cc.forestText : 'text-foreground',
                        )}
                      >
                        {step.done ? 'Ready' : 'Needed'}
                      </p>
                    </div>
                  );
                })}
              </div>

              <section className={cn(cc.card, 'p-4')}>
                <p className={cc.sectionLabel}>Your places</p>
                <div className="mt-3 divide-y divide-black/5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-3 text-left first:pt-0"
                    onClick={() => openEdit('home')}
                    data-testid="cleaner-city-route-edit-home"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC]">
                      <MapPinned className={cn('h-4 w-4', cc.forestText)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-muted-foreground">Home</span>
                      <span className="block truncate text-[14px] font-semibold text-foreground">
                        {homeLabel}
                      </span>
                    </span>
                    <span className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', cc.forestText)}>
                      Edit
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-3 text-left last:pb-0"
                    onClick={() => openEdit('office')}
                    data-testid="cleaner-city-route-edit-office"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC]">
                      <MapPinned className={cn('h-4 w-4', cc.forestText)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-muted-foreground">Office</span>
                      <span className="block truncate text-[14px] font-semibold text-foreground">
                        {officeLabel}
                      </span>
                    </span>
                    <span className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', cc.forestText)}>
                      Edit
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </button>
                </div>
              </section>

              <section className={cn(cc.card, 'p-4')}>
                <div className="flex items-start justify-between gap-3">
                  <p className={cc.sectionLabel}>Your roads</p>
                  <button
                    type="button"
                    className={cn('text-[13px] font-semibold', cc.forestText)}
                    onClick={() => openEdit('roads')}
                    data-testid="cleaner-city-route-change-roads"
                  >
                    Change roads
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <Route className={cn('mt-0.5 h-4 w-4 shrink-0', cc.forestText)} />
                    <div className="min-w-0">
                      <p className="text-[12px] text-muted-foreground">To office</p>
                      <p className="truncate text-[14px] font-semibold text-foreground">
                        {roadLine(toOffice, 'Road not set')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Route className={cn('mt-0.5 h-4 w-4 shrink-0', cc.forestText)} />
                    <div className="min-w-0">
                      <p className="text-[12px] text-muted-foreground">To home</p>
                      <p className="truncate text-[14px] font-semibold text-foreground">
                        {roadLine(toHome, 'Road not set')}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <button
                type="button"
                className={cn(cc.primaryBtn, 'w-full')}
                data-testid="cleaner-city-route-next"
                onClick={goLeaveTimes}
              >
                Continue to leave times
              </button>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h1 className="text-[22px] font-bold tracking-tight text-foreground">
                    {unlocked
                      ? editFocus === 'roads'
                        ? 'Choose your usual road'
                        : 'Edit your path'
                      : 'Set your path'}
                  </h1>
                  {unlocked ? (
                    <button
                      type="button"
                      className={cn('text-[13px] font-semibold', cc.forestText)}
                      onClick={() => setEditFocus(null)}
                      data-testid="cleaner-city-route-done-editing"
                    >
                      Done
                    </button>
                  ) : null}
                </div>
                <p className="text-[14px] leading-relaxed text-muted-foreground">
                  {unlocked
                    ? 'Update home, office, or the roads matching uses.'
                    : 'Mark home, office, and the roads between them.'}
                </p>
              </div>

              {!unlocked ? (
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { label: 'Home & office', done: hasPins, icon: MapPinned },
                      { label: 'To office', done: hasToOffice, icon: Route },
                      { label: 'To home', done: hasToHome, icon: Car },
                    ] as const
                  ).map((step) => {
                    const Icon = step.icon;
                    return (
                      <div
                        key={step.label}
                        className={cn(
                          'rounded-2xl border px-2.5 py-2.5',
                          step.done
                            ? 'border-[#0F3D2E]/25 bg-[#E8F2EC]'
                            : 'border-black/10 bg-white',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5',
                            step.done ? cc.forestText : 'text-muted-foreground',
                          )}
                        />
                        <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                          {step.label}
                        </p>
                        <p
                          className={cn(
                            'text-xs font-semibold',
                            step.done ? cc.forestText : 'text-foreground',
                          )}
                        >
                          {step.done ? 'Ready' : 'Needed'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {nextHint && !unlocked ? (
                <p
                  className="text-sm font-semibold text-foreground"
                  data-testid="cleaner-city-route-next-hint"
                >
                  {nextHint}
                </p>
              ) : null}

              {arrivalNotice ? (
                <div
                  className="rounded-2xl border border-[#0F3D2E]/20 bg-[#E8F2EC] px-4 py-3 text-sm leading-relaxed text-[#0F3D2E]"
                  data-testid="cleaner-city-route-guide"
                >
                  {arrivalNotice}
                </div>
              ) : null}

              <CleanerCityRouteSetupPanel
                key={panelKey}
                initialStep={editFocus || undefined}
                onSaved={(info) => {
                  if (info.roadSaved && info.toOffice && info.toHome) {
                    if (unlocked) {
                      setEditFocus(null);
                    } else {
                      goLeaveTimes();
                    }
                  }
                }}
              />

              {unlocked && editFocus !== 'roads' ? (
                <button
                  type="button"
                  className={cn(cc.primaryBtn, 'w-full')}
                  data-testid="cleaner-city-route-next"
                  onClick={goLeaveTimes}
                >
                  Continue to leave times
                </button>
              ) : null}
            </>
          )}
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
