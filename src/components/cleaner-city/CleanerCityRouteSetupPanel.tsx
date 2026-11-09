// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, MapPinned, Route, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import {
  CleanerCityRoutePreview,
  ROUTE_COLORS,
} from '@/components/cleaner-city/CleanerCityRoutePreview';
import { Button } from '@/components/ui/button';
import {
  preferredRouteFromProfile,
  useCleanerCityProfile,
  useCommuteTemplates,
  useOfficeLocations,
  useSetCommuteTemplate,
  useSetPreferredRoute,
  useUpsertOfficeLocation,
  type CommuteProfile,
} from '@/hooks/queries/useCleanerCity';
import { CLEANER_CITY_WEEKDAYS } from '@/lib/cleaner-city/constants';
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
    label: t.pickup_label || 'Home gate',
  };
}

function formatRouteMeta(alt: RouteAlternative) {
  const mins = Math.max(1, Math.round(alt.durationSeconds / 60));
  const km = (alt.distanceMeters / 1000).toFixed(1);
  return `~${mins} min · ${km} km`;
}

type Props = {
  compact?: boolean;
  /** Guest path: office + pickup pins only - no Google driving-road picker. */
  pinsOnly?: boolean;
  onSaved?: (info: { officeDone: boolean; pickupDone: boolean; toOffice: boolean; toHome: boolean }) => void;
  className?: string;
};

export function CleanerCityRouteSetupPanel({ compact, pinsOnly, onSaved, className }: Props) {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const upsertOffice = useUpsertOfficeLocation();
  const setTemplate = useSetCommuteTemplate();
  const setPreferredRoute = useSetPreferredRoute();
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
  const [wizardStep, setWizardStep] = useState<WizardStep | null>(null);

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

  // One focused step at a time: home → office → roads (hosts) / done (guests).
  // Re-sync only while the user has not manually moved via Back / Save.
  const [wizardTouched, setWizardTouched] = useState(false);
  useEffect(() => {
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
  }, [pickupDone, officeDone, pinsOnly, wizardTouched]);

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

  const emitProgress = (nextProfile?: CommuteProfile | null) => {
    const p = nextProfile || profile;
    onSaved?.({
      officeDone: !!primary || !!office,
      pickupDone: daysWithPickup.length >= 5,
      toOffice: !!preferredRouteFromProfile(p as CommuteProfile, 'to_office'),
      toHome: !!preferredRouteFromProfile(p as CommuteProfile, 'to_home'),
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
      toast.error('Pin your home / society gate on the map before saving');
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
      toast.success('Home gate saved - next, pin your office');
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
        direction === 'to_office'
          ? 'Morning road saved (home to office)'
          : 'Evening road saved (office to home)',
      );
      emitProgress(updated);
      if (direction === 'to_office' && !preferredRouteFromProfile(updated as CommuteProfile, 'to_home')) {
        setDirection('to_home');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not save preferred road');
    } finally {
      setSavingRoute(false);
    }
  };

  const stepIndex = wizardStep === 'home' ? 0 : wizardStep === 'office' ? 1 : 2;
  const stepCount = pinsOnly ? 2 : 3;
  const stepTitle =
    wizardStep === 'home'
      ? 'Where do mornings start?'
      : wizardStep === 'office'
        ? 'Where do you work?'
        : 'Which road do you drive?';
  const stepBlurb =
    wizardStep === 'home'
      ? 'One society gate for Mon-Fri. Times come later - the gate usually stays the same.'
      : wizardStep === 'office'
        ? 'Drop the blue pin on your office building, then continue.'
        : 'Home and office are set. Pick the road you actually take - morning, then evening.';

  return (
    <div
      className={cn('space-y-5', className)}
      data-testid="cleaner-city-route-setup-panel"
      data-wizard-step={wizardStep || 'boot'}
    >
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3 overflow-hidden relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(120% 80% at 10% 0%, hsl(var(--primary) / 0.12), transparent 55%), radial-gradient(90% 70% at 100% 100%, hsl(142 70% 40% / 0.08), transparent 50%)',
          }}
        />
        <div className="relative space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{stepTitle}</p>
                <p className="text-[11px] text-muted-foreground">
                  Step {Math.min(stepIndex + 1, stepCount)} of {stepCount}
                  {pinsOnly ? ' · guest pins' : ''}
                </p>
              </div>
            </div>
            {wizardStep !== 'home' ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
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

          <div className="flex gap-1.5" data-testid="cleaner-city-route-wizard-dots">
            {Array.from({ length: stepCount }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  i <= stepIndex ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{stepBlurb}</p>

          <div className="flex flex-wrap gap-1.5">
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-bold',
                pickupDone
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                  : wizardStep === 'home'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
              )}
            >
              {pickupDone ? 'Home gate set' : '1 · Home gate'}
            </span>
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-bold',
                officeDone
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                  : wizardStep === 'office'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
              )}
            >
              {officeDone ? 'Office set' : '2 · Office'}
            </span>
            {!pinsOnly ? (
              <>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-bold',
                    savedToOffice
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                      : wizardStep === 'roads'
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                  )}
                  data-testid="cleaner-city-usual-route-to-office"
                >
                  {savedToOffice ? `Morning · ${savedToOffice.summary}` : '3 · Morning road'}
                </span>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-bold',
                    savedToHome
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                      : 'border-border text-muted-foreground',
                  )}
                  data-testid="cleaner-city-usual-route-to-home"
                >
                  {savedToHome ? `Evening · ${savedToHome.summary}` : 'Evening road'}
                </span>
              </>
            ) : (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                Guest path - pins only
              </span>
            )}
          </div>
        </div>
      </div>

      {wizardStep === 'home' ? (
        <div className="space-y-3" data-testid="cleaner-city-route-step-home">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-start gap-2">
              <MapPinned size={16} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">Usual home / society gate</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One pin for Mon-Fri mornings. Times change later - the gate usually does not.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WORK_WEEK.map((d) => {
                const covered = daysWithPickup.includes(d);
                const label = CLEANER_CITY_WEEKDAYS.find((w) => w.value === d)?.label || String(d);
                return (
                  <span
                    key={d}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                      covered
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {covered ? <Check size={10} /> : null}
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          <CleanerCityPinPicker
            title="Pickup near home / society"
            hint="Move the map so the blue pin sits on your usual morning gate"
            value={pickup}
            onChange={setPickup}
            testId="cleaner-city-pickup-pin"
          />
          <Button
            className="h-11 w-full font-semibold"
            onClick={saveUsualWorkWeekPickup}
            disabled={savingPickup || setTemplate.isPending}
            data-testid="cleaner-city-pickup-save-week"
          >
            {savingPickup || setTemplate.isPending
              ? 'Saving Mon-Fri…'
              : 'Save home gate, then office'}
          </Button>
        </div>
      ) : null}

      {wizardStep === 'office' ? (
        <div className="space-y-3" data-testid="cleaner-city-route-step-office">
          {pickupDone && pickup ? (
            <p className="text-xs text-muted-foreground px-1">
              Home gate ready · {pickup.label}
              {!pinsOnly ? ' · roads unlock after office' : ''}
            </p>
          ) : null}
          <CleanerCityPinPicker
            title="Office location"
            hint="Search or move the map under the blue pin"
            value={office}
            onChange={setOffice}
            testId="cleaner-city-office-pin"
          />
          <Button
            className="h-11 w-full font-semibold"
            onClick={saveOffice}
            disabled={savingOffice || upsertOffice.isPending}
            data-testid="cleaner-city-office-save"
          >
            {savingOffice || upsertOffice.isPending
              ? 'Saving…'
              : pinsOnly
                ? officeDone
                  ? 'Update office pin'
                  : 'Save office pin'
                : officeDone
                  ? 'Update office, then choose roads'
                  : 'Save office, then choose roads'}
          </Button>
          {pinsOnly ? (
            <p className="text-xs text-muted-foreground px-1" data-testid="cleaner-city-guest-pins-hint">
              {officeDone && pickupDone
                ? 'Office and pickup are set - Find can match you on neighbours routes.'
                : 'Save office after home - Find uses these pins to match corridor rides. No car or road pick needed.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {wizardStep === 'roads' && !pinsOnly ? (
        <div
          className="rounded-2xl border border-border bg-card p-4 space-y-3"
          data-testid="cleaner-city-route-choice"
        >
          <div className="flex items-start gap-2">
            <Route size={16} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Choose your usual road</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Google auto-suggests roads between your pins. Tap a dotted path on the map or a card.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'to_office' as const, label: 'To office' },
                { id: 'to_home' as const, label: 'To home' },
              ] as const
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDirection(d.id)}
                className={cn(
                  'h-10 rounded-xl border text-xs font-extrabold',
                  direction === d.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
                data-testid={`cleaner-city-route-dir-${d.id}`}
              >
                {d.label}
                {(d.id === 'to_office' ? savedToOffice : savedToHome) ? (
                  <span className="ml-1 text-[10px] font-bold text-emerald-600">✓</span>
                ) : null}
              </button>
            ))}
          </div>

          {loadingRoutes ? (
            <p className="text-xs text-muted-foreground">Loading Google driving options…</p>
          ) : null}

          {routeFetchError ? (
            <div
              className={cn(
                'rounded-xl border px-3 py-2 space-y-2',
                routeAlts.some((a) => a.provider !== 'haversine_fallback')
                  ? 'border-border bg-muted/40'
                  : 'border-amber-500/40 bg-amber-500/10',
              )}
              data-testid="cleaner-city-route-offline-notice"
            >
              <p
                className={cn(
                  'text-xs',
                  routeAlts.some((a) => a.provider !== 'haversine_fallback')
                    ? 'text-muted-foreground'
                    : 'text-amber-950 dark:text-amber-100',
                )}
              >
                {routeFetchError}
              </p>
              {routeStatus && !routeAlts.some((a) => a.provider !== 'haversine_fallback') ? (
                <p className="text-[10px] font-mono text-amber-800/80 dark:text-amber-200/80">
                  Status: {routeStatus}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setRouteRetryKey((k) => k + 1)}
                data-testid="cleaner-city-route-retry"
              >
                Retry roads
              </Button>
            </div>
          ) : null}

          {routeAlts.length > 0 ? (
            <CleanerCityRoutePreview
              alternatives={routeAlts}
              selectedId={selectedRouteId}
              onSelect={setSelectedRouteId}
              testId="cleaner-city-route-choice-preview"
            />
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
                    'rounded-xl border px-3.5 py-3 text-left transition-colors',
                    selected ? 'bg-primary/10' : 'border-border hover:border-primary/40',
                  )}
                  style={
                    selected
                      ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` }
                      : { borderLeftWidth: 4, borderLeftColor: color }
                  }
                  data-testid={`cleaner-city-route-alt-${alt.id}`}
                >
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {index + 1}
                    </span>
                    {selected ? <Check size={14} style={{ color }} /> : null}
                    {alt.summary}
                    {alt.provider === 'haversine_fallback' ? (
                      <span className="text-[10px] font-bold uppercase text-amber-700">Approx</span>
                    ) : alt.provider === 'osrm' ? (
                      <span className="text-[10px] font-bold uppercase text-emerald-700">Road</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatRouteMeta(alt)}</p>
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

          <Button
            className="h-11 w-full font-semibold"
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
              ? 'Saving road…'
              : direction === 'to_office'
                ? 'Save morning road (to office)'
                : 'Save evening road (to home)'}
          </Button>

          {roadsDone ? (
            <p className="text-xs text-emerald-600 font-semibold px-1">
              Morning and evening roads are saved.
            </p>
          ) : !compact ? (
            <p className="text-[11px] text-muted-foreground">
              Save morning first, then switch to To home and save the evening road too.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
