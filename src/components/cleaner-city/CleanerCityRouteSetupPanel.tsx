// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Route } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import {
  CleanerCityRoutePreview,
  ROUTE_COLORS,
} from '@/components/cleaner-city/CleanerCityRoutePreview';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import {
  preferredRouteFromProfile,
  useCleanerCityProfile,
  useCommuteTemplates,
  useMaybeEnableDefaultAutopilot,
  useOfficeLocations,
  useSetCommuteTemplate,
  useSetPreferredRoute,
  useUpsertOfficeLocation,
  type CommuteProfile,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import {
  fetchDrivingRouteAlternativesDetailed,
  savePreferredRoute,
  type RouteAlternative,
} from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Pin = { lat: number; lng: number; label: string; address?: string };
type Direction = 'to_office' | 'to_home';
type WizardStep = 'home' | 'office' | 'roads';

const WORK_WEEK = [1, 2, 3, 4, 5] as const;

function pinFromTemplate(t: {
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
  pickup_label?: string | null;
} | null | undefined): Pin | null {
  if (
    !t ||
    typeof t.pickup_latitude !== 'number' ||
    typeof t.pickup_longitude !== 'number' ||
    !Number.isFinite(t.pickup_latitude) ||
    !Number.isFinite(t.pickup_longitude)
  ) {
    return null;
  }
  return {
    lat: t.pickup_latitude,
    lng: t.pickup_longitude,
    label: t.pickup_label || 'Home',
  };
}

function formatRouteMeta(alt: RouteAlternative) {
  const mins = Math.max(1, Math.round(alt.durationSeconds / 60));
  const km = (alt.distanceMeters / 1000).toFixed(1);
  return `~${mins} min - ${km} km`;
}

type Props = {
  compact?: boolean;
  /** Guest path: office + pickup pins only - no Google driving-road picker. */
  pinsOnly?: boolean;
  /** Offer embed: short titles, no status essay chips. */
  quiet?: boolean;
  /** Open on a specific wizard step (Route page edit focus). */
  initialStep?: WizardStep;
  onSaved?: (info: {
    officeDone: boolean;
    pickupDone: boolean;
    toOffice: boolean;
    toHome: boolean;
    roadSaved?: boolean;
  }) => void;
  className?: string;
};

export function CleanerCityRouteSetupPanel({
  compact,
  pinsOnly,
  quiet,
  initialStep,
  onSaved,
  className,
}: Props) {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const upsertOffice = useUpsertOfficeLocation();
  const setTemplate = useSetCommuteTemplate();
  const setPreferredRoute = useSetPreferredRoute();
  const maybeEnableAutopilot = useMaybeEnableDefaultAutopilot();
  const { isLoaded } = useGoogleMaps();

  const primary = offices.find((o) => o.is_primary) || offices[0] || null;
  const [office, setOffice] = useState<Pin | null>(null);
  const [pickup, setPickup] = useState<Pin | null>(null);
  const [direction, setDirection] = useState<Direction>('to_office');
  const [routeAlts, setRouteAlts] = useState<RouteAlternative[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeFetchError, setRouteFetchError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [acceptApprox, setAcceptApprox] = useState(false);
  const [savingOffice, setSavingOffice] = useState(false);
  const [savingPickup, setSavingPickup] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeRetryKey, setRouteRetryKey] = useState(0);
  const [wizardStep, setWizardStep] = useState<WizardStep | null>(
    initialStep || null,
  );

  const selectedRoute = useMemo(
    () => routeAlts.find((r) => r.id === selectedRouteId) || null,
    [routeAlts, selectedRouteId],
  );

  const daysWithPickup = useMemo(
    () => WORK_WEEK.filter((d) => !!pinFromTemplate(templates.find((t) => t.weekday === d))),
    [templates],
  );

  const usualPickup = useMemo(() => {
    for (const d of WORK_WEEK) {
      const pin = pinFromTemplate(templates.find((t) => t.weekday === d));
      if (pin) return pin;
    }
    return null;
  }, [templates]);

  const savedToOffice = preferredRouteFromProfile(profile as CommuteProfile, 'to_office');
  const savedToHome = preferredRouteFromProfile(profile as CommuteProfile, 'to_home');
  const officeDone = !!primary;
  const pickupDone = daysWithPickup.length >= 5;
  const roadsDone = !!savedToOffice && !!savedToHome;

  useEffect(() => {
    if (!primary) return;
    setOffice({
      lat: primary.latitude,
      lng: primary.longitude,
      label: primary.label || 'Office',
      address: primary.address_text || undefined,
    });
  }, [primary?.id]);

  useEffect(() => {
    if (pickup) return;
    if (usualPickup) setPickup(usualPickup);
  }, [usualPickup?.lat, usualPickup?.lng, usualPickup?.label]);

  // One focused step at a time: home -> office -> roads (hosts) / done (guests).
  // Re-sync only while the user has not manually moved via Back / Save.
  const [wizardTouched, setWizardTouched] = useState(!!initialStep);
  useEffect(() => {
    if (initialStep) {
      setWizardStep(pinsOnly && initialStep === 'roads' ? 'office' : initialStep);
      setWizardTouched(true);
      return;
    }
    if (wizardTouched) return;
    if (!pickupDone) {
      setWizardStep('home');
      return;
    }
    if (!officeDone) {
      setWizardStep('office');
      return;
    }
    setWizardStep(pinsOnly ? 'office' : 'roads');
  }, [pickupDone, officeDone, pinsOnly, wizardTouched, initialStep]);

  const routeOrigin = direction === 'to_office' ? pickup : office;
  const routeDest = direction === 'to_office' ? office : pickup;
  const canFetchRoads =
    !pinsOnly &&
    wizardStep === 'roads' &&
    !!office &&
    !!pickup &&
    officeDone &&
    pickupDone;

  useEffect(() => {
    if (!canFetchRoads || !routeOrigin || !routeDest) {
      setRouteAlts([]);
      setSelectedRouteId(null);
      setRouteFetchError(null);
      setRouteStatus(null);
      return;
    }
    if (!isLoaded) {
      setRouteFetchError('Google Maps is still loading. Wait a moment, then tap Retry.');
      setRouteAlts([]);
      setSelectedRouteId(null);
      return;
    }
    let cancelled = false;
    setLoadingRoutes(true);
    setRouteFetchError(null);
    setAcceptApprox(false);
    setSelectedRouteId(null);
    void fetchDrivingRouteAlternativesDetailed(routeOrigin, routeDest)
      .then((packed) => {
        if (cancelled) return;
        setRouteAlts(packed.alternatives);
        setRouteStatus(packed.status);
        const hasRealRoad = packed.alternatives.some((a) => a.provider !== 'haversine_fallback');
        if (!packed.googleOk && packed.message) {
          setRouteFetchError(packed.message);
        } else if (packed.alternatives.length === 0) {
          setRouteFetchError('No driving paths found for these pins.');
        }
        if (hasRealRoad && packed.alternatives[0]) {
          setSelectedRouteId(packed.alternatives[0].id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRouteAlts([]);
        setRouteStatus('FETCH_FAILED');
        setRouteFetchError(
          'Could not load Google driving options. Check your connection, then tap Retry.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingRoutes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canFetchRoads,
    routeOrigin?.lat,
    routeOrigin?.lng,
    routeDest?.lat,
    routeDest?.lng,
    direction,
    isLoaded,
    routeRetryKey,
  ]);

  const emitProgress = (
    nextProfile?: CommuteProfile | null,
    extras?: { roadSaved?: boolean },
  ) => {
    const p = nextProfile || profile;
    onSaved?.({
      officeDone: !!primary || !!office,
      pickupDone: daysWithPickup.length >= 5,
      toOffice: !!preferredRouteFromProfile(p as CommuteProfile, 'to_office'),
      toHome: !!preferredRouteFromProfile(p as CommuteProfile, 'to_home'),
      roadSaved: extras?.roadSaved,
    });
  };

  const saveOffice = async () => {
    if (!office) {
      toast.error('Pin your office on the map');
      return;
    }
    setSavingOffice(true);
    try {
      await upsertOffice.mutateAsync({
        latitude: office.lat,
        longitude: office.lng,
        label: office.label,
        address_text: office.address || null,
        is_primary: true,
        office_id: primary?.id || null,
      });
      toast.success(pinsOnly ? 'Office pin saved' : 'Office saved - next, pick your roads');
      emitProgress();
      setWizardTouched(true);
      setWizardStep(pinsOnly ? 'office' : 'roads');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save office');
    } finally {
      setSavingOffice(false);
    }
  };

  const saveUsualWorkWeekPickup = async () => {
    if (
      !pickup ||
      !Number.isFinite(pickup.lat) ||
      !Number.isFinite(pickup.lng) ||
      pickup.lat < -90 ||
      pickup.lat > 90 ||
      pickup.lng < -180 ||
      pickup.lng > 180
    ) {
      toast.error('Place the pin on your home first');
      return;
    }
    setSavingPickup(true);
    try {
      for (const day of WORK_WEEK) {
        const existing = templates.find((t) => t.weekday === day);
        await setTemplate.mutateAsync({
          weekday: day,
          is_working: existing?.is_working ?? true,
          depart_time: existing?.depart_time || '08:30',
          return_time: existing?.return_time || '18:30',
          pickup_label: pickup.label,
          pickup_latitude: pickup.lat,
          pickup_longitude: pickup.lng,
        });
      }
      toast.success('Home saved - now set your office');
      emitProgress();
      setWizardTouched(true);
      setWizardStep('office');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save pickup');
    } finally {
      setSavingPickup(false);
    }
  };

  const saveChosenRoad = async () => {
    if (!user?.id || !routeOrigin || !routeDest) {
      toast.error('Save home and office pins first');
      return;
    }
    if (!selectedRoute) {
      toast.error('Tap a road card to choose your usual path');
      return;
    }
    if (selectedRoute.provider === 'haversine_fallback' && !acceptApprox) {
      toast.error('Confirm you understand this is only an approximate path');
      return;
    }
    setSavingRoute(true);
    try {
      const payload = {
        polyline: selectedRoute.polyline,
        distanceMeters: selectedRoute.distanceMeters,
        durationSeconds: selectedRoute.durationSeconds,
        summary: selectedRoute.summary,
        originLat: routeOrigin.lat,
        originLng: routeOrigin.lng,
        destLat: routeDest.lat,
        destLng: routeDest.lng,
        savedAt: new Date().toISOString(),
      };
      savePreferredRoute(user.id, payload, direction);
      const updated = await setPreferredRoute.mutateAsync({
        ...payload,
        direction,
      });
      toast.success(
        direction === 'to_office' ? 'Road to office saved' : 'Road home saved',
      );
      emitProgress(updated, { roadSaved: true });
      try {
        await maybeEnableAutopilot.mutateAsync();
      } catch {
        // Non-blocking.
      }
      if (direction === 'to_office' && !preferredRouteFromProfile(updated as CommuteProfile, 'to_home')) {
        setDirection('to_home');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not save preferred road');
    } finally {
      setSavingRoute(false);
    }
  };

  const stepTitle =
    wizardStep === 'home'
      ? 'Set your home'
      : wizardStep === 'office'
        ? 'Set your office'
        : 'Pick your road';
  const stepBlurb =
    wizardStep === 'home'
      ? 'Put the pin where you leave from each day.'
      : wizardStep === 'office'
        ? 'Put the pin on your office building.'
        : 'Pick the road you take to office, then the road back home.';

  const progressChips = [
    {
      key: 'home',
      label: 'Home',
      done: pickupDone,
      active: wizardStep === 'home',
      testId: undefined as string | undefined,
      onClick: () => {
        setWizardTouched(true);
        setWizardStep('home');
      },
    },
    {
      key: 'office',
      label: 'Office',
      done: officeDone,
      active: wizardStep === 'office',
      testId: undefined as string | undefined,
      onClick: () => {
        setWizardTouched(true);
        setWizardStep('office');
      },
    },
    ...(!pinsOnly
      ? [
          {
            key: 'to_office',
            label: 'To office',
            done: !!savedToOffice,
            active: wizardStep === 'roads' && direction === 'to_office',
            testId: 'cleaner-city-usual-route-to-office',
            onClick: () => {
              setWizardTouched(true);
              setWizardStep('roads');
              setDirection('to_office');
            },
          },
          {
            key: 'to_home',
            label: 'To home',
            done: !!savedToHome,
            active: wizardStep === 'roads' && direction === 'to_home',
            testId: 'cleaner-city-usual-route-to-home',
            onClick: () => {
              setWizardTouched(true);
              setWizardStep('roads');
              setDirection('to_home');
            },
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn(quiet || compact ? 'space-y-3' : 'space-y-5', className)}
      data-testid="cleaner-city-route-setup-panel"
      data-wizard-step={wizardStep || 'boot'}
    >
      <div
        className={cn(
          'relative space-y-3 overflow-hidden',
          quiet ? cn(cc.card, 'p-3') : cn(cc.card, 'p-4'),
        )}
      >
        <div className="relative space-y-3">
          {!quiet ? (
            <div className="overflow-x-auto" data-testid="cleaner-city-route-wizard-tabs">
              <nav className="flex min-w-max gap-1 border-b border-black/5" aria-label="Route steps">
                {(
                  pinsOnly
                    ? ([
                        { id: 'home', label: 'Home' },
                        { id: 'office', label: 'Office' },
                      ] as const)
                    : ([
                        { id: 'home', label: 'Home' },
                        { id: 'office', label: 'Office' },
                        { id: 'roads', label: 'Roads' },
                      ] as const)
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setWizardTouched(true);
                      setWizardStep(item.id);
                    }}
                    className={cn(
                      'shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                      wizardStep === item.id
                        ? 'border-[#0F3D2E] text-[#0F3D2E]'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          ) : null}

          {!quiet ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{stepTitle}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{stepBlurb}</p>
              </div>
              {wizardStep !== 'home' ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setWizardTouched(true);
                    setWizardStep(wizardStep === 'roads' ? 'office' : 'home');
                  }}
                  data-testid="cleaner-city-route-wizard-back"
                >
                  <ArrowLeft size={12} />
                  Back
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {progressChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                data-testid={chip.testId}
                onClick={chip.onClick}
                className={cn(
                  'rounded-full border px-2.5 py-1.5 text-center text-[11px] font-semibold transition',
                  chip.active
                    ? 'border-[#0F3D2E] bg-[#0F3D2E] text-white'
                    : chip.done
                      ? 'border-[#0F3D2E]/30 bg-[#E8F2EC] text-[#0F3D2E]'
                      : 'border-black/10 bg-white text-muted-foreground',
                )}
              >
                {chip.done && !chip.active ? `${chip.label} ✓` : chip.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {wizardStep === 'home' ? (
        <div className="space-y-3" data-testid="cleaner-city-route-step-home">
          <CleanerCityPinPicker
            title="Home"
            hint="Search or drag the map to your home"
            value={pickup}
            onChange={setPickup}
            testId="cleaner-city-pickup-pin"
          />
          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            onClick={saveUsualWorkWeekPickup}
            disabled={savingPickup || setTemplate.isPending}
            data-testid="cleaner-city-pickup-save-week"
          >
            {savingPickup || setTemplate.isPending ? 'Saving...' : 'Save home'}
          </button>
        </div>
      ) : null}

      {wizardStep === 'office' ? (
        <div className="space-y-3" data-testid="cleaner-city-route-step-office">
          {pickupDone && pickup ? (
            <p className="truncate px-1 text-xs text-muted-foreground">
              Home set - {pickup.label}
            </p>
          ) : null}
          <CleanerCityPinPicker
            title="Office"
            hint="Search or drag the map to your office"
            value={office}
            onChange={setOffice}
            testId="cleaner-city-office-pin"
          />
          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            onClick={saveOffice}
            disabled={savingOffice || upsertOffice.isPending}
            data-testid="cleaner-city-office-save"
          >
            {savingOffice || upsertOffice.isPending
              ? 'Saving...'
              : officeDone
                ? 'Update office'
                : 'Save office'}
          </button>
          {pinsOnly ? (
            <p className="px-1 text-xs text-muted-foreground" data-testid="cleaner-city-guest-pins-hint">
              {officeDone && pickupDone
                ? 'Home and office are set.'
                : 'Save office to finish your pins.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {wizardStep === 'roads' && !pinsOnly ? (
        <div
          className={cn(cc.card, 'space-y-3 p-4')}
          data-testid="cleaner-city-route-choice"
        >
          <div className="flex items-start gap-2">
            <Route size={16} className={cn('mt-0.5 shrink-0', cc.forestText)} />
            <div>
              <p className="text-sm font-semibold">Your usual road</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tap a route on the map or a card below.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <nav
              className="flex min-w-max gap-1 border-b border-black/5"
              data-testid="cleaner-city-route-dir-tabs"
            >
              {(
                [
                  { id: 'to_office' as const, label: 'To office', saved: !!savedToOffice },
                  { id: 'to_home' as const, label: 'To home', saved: !!savedToHome },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDirection(d.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                    direction === d.id
                      ? 'border-[#0F3D2E] text-[#0F3D2E]'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`cleaner-city-route-dir-${d.id}`}
                >
                  {d.label}
                  {d.saved ? <Check size={12} className="text-[#0F3D2E]" /> : null}
                </button>
              ))}
            </nav>
          </div>

          {loadingRoutes ? (
            <p className="text-xs text-muted-foreground">Finding roads...</p>
          ) : null}

          {routeFetchError ? (
            <div
              className={cn(
                'space-y-2 rounded-xl border px-3 py-2',
                routeAlts.some((a) => a.provider !== 'haversine_fallback')
                  ? 'border-black/10 bg-[#F7F5F1]'
                  : 'border-amber-500/40 bg-amber-500/10',
              )}
              data-testid="cleaner-city-route-offline-notice"
            >
              <p
                className={cn(
                  'text-xs',
                  routeAlts.some((a) => a.provider !== 'haversine_fallback')
                    ? 'text-muted-foreground'
                    : 'text-amber-950',
                )}
              >
                {routeFetchError}
              </p>
              {routeStatus && !routeAlts.some((a) => a.provider !== 'haversine_fallback') ? (
                <p className="font-mono text-[10px] text-amber-800/80">
                  Status: {routeStatus}
                </p>
              ) : null}
              <button
                type="button"
                className={cn(cc.secondaryBtn, 'h-9 px-3 text-[13px]')}
                onClick={() => setRouteRetryKey((k) => k + 1)}
                data-testid="cleaner-city-route-retry"
              >
                Retry
              </button>
            </div>
          ) : null}

          {routeAlts.length > 0 ? (
            <>
              <CleanerCityRoutePreview
                alternatives={routeAlts}
                selectedId={selectedRouteId}
                onSelect={setSelectedRouteId}
                testId="cleaner-city-route-choice-preview"
              />
              <p className="text-[12px] text-muted-foreground">
                {routeAlts.length} Google road{routeAlts.length === 1 ? '' : 's'} shown. Tap a
                path or its number to choose.
              </p>
            </>
          ) : null}

          <div className="flex flex-col gap-2">
            {routeAlts.map((alt, index) => {
              const selected = selectedRouteId === alt.id;
              const color = ROUTE_COLORS[index % ROUTE_COLORS.length].ink;
              return (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => setSelectedRouteId(alt.id)}
                  className={cn(
                    'rounded-2xl border px-3.5 py-3 text-left transition-colors',
                    selected
                      ? 'border-[#0F3D2E] bg-[#E8F2EC]'
                      : 'border-black/10 bg-white hover:border-[#0F3D2E]/35',
                  )}
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: selected ? '#0F3D2E' : color,
                  }}
                  data-testid={`cleaner-city-route-alt-${alt.id}`}
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: selected ? '#0F3D2E' : color }}
                    >
                      {index + 1}
                    </span>
                    {selected ? <Check size={14} className="text-[#0F3D2E]" /> : null}
                    {alt.summary}
                    {alt.provider === 'haversine_fallback' ? (
                      <span className="text-[10px] font-bold uppercase text-amber-700">Approx</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatRouteMeta(alt)}</p>
                </button>
              );
            })}
          </div>

          {selectedRoute?.provider === 'haversine_fallback' ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acceptApprox}
                onChange={(e) => setAcceptApprox(e.target.checked)}
                data-testid="cleaner-city-route-accept-approx"
              />
              <span>
                I understand this is not a real Google road - matching may be less accurate until Maps works.
              </span>
            </label>
          ) : null}

          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            onClick={saveChosenRoad}
            disabled={
              savingRoute ||
              setPreferredRoute.isPending ||
              !selectedRoute ||
              (selectedRoute?.provider === 'haversine_fallback' && !acceptApprox)
            }
            data-testid="cleaner-city-route-save-road"
          >
            {savingRoute || setPreferredRoute.isPending
              ? 'Saving...'
              : 'Save this road'}
          </button>

          {!roadsDone ? (
            <p className="text-[11px] text-muted-foreground">
              {!savedToOffice
                ? 'First save the road to office.'
                : 'Now save the road home.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
