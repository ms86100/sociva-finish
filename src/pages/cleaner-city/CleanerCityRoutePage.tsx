// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, MapPinned, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCleanerCityProfile,
  useOfficeLocations,
  useSetCommuteTemplate,
  useSetPreferredRoute,
  useCommuteTemplates,
  useUpsertOfficeLocation,
} from '@/hooks/queries/useCleanerCity';
import { CLEANER_CITY_WEEKDAYS } from '@/lib/cleaner-city/constants';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import {
  fetchDrivingRouteAlternatives,
  savePreferredRoute,
  type RouteAlternative,
} from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Pin = { lat: number; lng: number; label: string; address?: string };
type RouteTab = 'office' | 'pickup';

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

export default function CleanerCityRoutePage() {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const upsertOffice = useUpsertOfficeLocation();
  const setTemplate = useSetCommuteTemplate();
  const setPreferredRoute = useSetPreferredRoute();
  const { isLoaded } = useGoogleMaps();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const [guide, setGuide] = useState<string | null>(null);
  const [showDayOverride, setShowDayOverride] = useState(false);
  const [overrideDay, setOverrideDay] = useState(1);
  const [savingWeek, setSavingWeek] = useState(false);
  const [tab, setTab] = useState<RouteTab>('office');
  const [routeAlts, setRouteAlts] = useState<RouteAlternative[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const primary = offices.find((o) => o.is_primary) || offices[0] || null;
  const [office, setOffice] = useState<Pin | null>(null);
  const [pickup, setPickup] = useState<Pin | null>(null);

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

  useEffect(() => {
    if (!showDayOverride) return;
    const dayPin = pinFromTemplate(templates.find((t) => t.weekday === overrideDay));
    if (dayPin) setPickup(dayPin);
    else if (usualPickup) setPickup(usualPickup);
  }, [overrideDay, showDayOverride]);

  const officeDone = !!primary;
  const pickupDone = daysWithPickup.length >= 5;
  const questStep = !officeDone ? 1 : !pickupDone ? 2 : 3;

  useEffect(() => {
    if (!officeDone) setTab('office');
    else if (!pickupDone) setTab('pickup');
  }, [officeDone, pickupDone]);

  const saveOffice = async () => {
    if (!office) {
      toast.error('Pin your office on the map');
      return;
    }
    try {
      await upsertOffice.mutateAsync({
        latitude: office.lat,
        longitude: office.lng,
        label: office.label,
        address_text: office.address || null,
        is_primary: true,
        office_id: primary?.id || null,
      });
      setGuide('Office locked. Next: pin the gate you walk out of on work mornings.');
      setTab('pickup');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save office');
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
    if (office && routeAlts.length > 1 && !selectedRoute) {
      toast.error('Pick which road you take before saving');
      return;
    }
    setSavingWeek(true);
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
      if (user?.id && office && selectedRoute) {
        const payload = {
          polyline: selectedRoute.polyline,
          distanceMeters: selectedRoute.distanceMeters,
          durationSeconds: selectedRoute.durationSeconds,
          summary: selectedRoute.summary,
          originLat: pickup.lat,
          originLng: pickup.lng,
          destLat: office.lat,
          destLng: office.lng,
          savedAt: new Date().toISOString(),
        };
        savePreferredRoute(user.id, payload);
        try {
          await setPreferredRoute.mutateAsync({
            polyline: payload.polyline,
            distanceMeters: payload.distanceMeters,
            durationSeconds: payload.durationSeconds,
            summary: payload.summary,
            originLat: payload.originLat,
            originLng: payload.originLng,
            destLat: payload.destLat,
            destLng: payload.destLng,
          });
        } catch {
          // localStorage already saved - DB sync best-effort
        }
      }
      setGuide('Home gate set for Mon-Fri. Most people stop here - times come next.');
      navigate('/cleaner-city/schedule', {
        state: {
          notice:
            'Home gate saved for your work week. Now set the time you leave and come back - that is what changes day to day, not the gate.',
        },
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not save pickup');
    } finally {
      setSavingWeek(false);
    }
  };

  const savePickupForOneDay = async () => {
    if (
      !pickup ||
      !Number.isFinite(pickup.lat) ||
      !Number.isFinite(pickup.lng) ||
      pickup.lat < -90 ||
      pickup.lat > 90 ||
      pickup.lng < -180 ||
      pickup.lng > 180
    ) {
      toast.error('Pin a real pickup point on the map before saving');
      return;
    }
    const existing = templates.find((t) => t.weekday === overrideDay);
    try {
      await setTemplate.mutateAsync({
        weekday: overrideDay,
        is_working: existing?.is_working ?? true,
        depart_time: existing?.depart_time || '08:30',
        return_time: existing?.return_time || '18:30',
        pickup_label: pickup.label,
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
      });
      const dayName = CLEANER_CITY_WEEKDAYS.find((w) => w.value === overrideDay)?.full || 'that day';
      toast.success(`Override saved for ${dayName}`);
      setGuide(`${dayName} now uses a different gate. Other workdays keep your usual pin.`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save pickup');
    }
  };

  useEffect(() => {
    if (!office || !pickup || !isLoaded) return;
    let cancelled = false;
    setLoadingRoutes(true);
    void fetchDrivingRouteAlternatives(pickup, office)
      .then((alts) => {
        if (cancelled) return;
        setRouteAlts(alts);
        setSelectedRouteId((prev) => {
          if (prev && alts.some((a) => a.id === prev)) return prev;
          return alts.length === 1 ? alts[0].id : null;
        });
        if (alts.length > 1) {
          setGuide('Which road will you take? Pick one so matching uses the same path.');
        }
      })
      .catch(() => {
        if (!cancelled) setRouteAlts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoutes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [office?.lat, office?.lng, pickup?.lat, pickup?.lng, isLoaded]);

  if (!profile) {
    return (
      <AppLayout headerTitle="Route pins">
        <CleanerCityGate>
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="text-primary font-semibold">
                set up
              </Link>{' '}
              first.
            </p>
          </div>
        </CleanerCityGate>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Office & pickup">
      <CleanerCityGate>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-28 pt-4" data-testid="cleaner-city-route-page">
          {(arrivalNotice || guide) && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed" data-testid="cleaner-city-route-guide">
              {guide || arrivalNotice}
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              <p className="text-sm font-semibold">Commute map quest</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { n: 1, label: 'Office', done: officeDone },
                { n: 2, label: 'Home gate', done: pickupDone },
                { n: 3, label: 'Times', done: false },
              ].map((step) => (
                <div
                  key={step.n}
                  className={cn(
                    'rounded-xl border px-2 py-2',
                    questStep === step.n && 'border-primary bg-primary/10',
                    step.done && 'border-emerald-500/40 bg-emerald-500/10',
                  )}
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Step {step.n}</p>
                  <p className="text-xs font-semibold flex items-center justify-center gap-1">
                    {step.done && <Check size={12} className="text-emerald-500" />}
                    {step.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as RouteTab)} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-11">
              <TabsTrigger value="office" data-testid="cleaner-city-tab-office" className="gap-1.5">
                {officeDone && <Check size={12} className="text-emerald-500" />}
                Office
              </TabsTrigger>
              <TabsTrigger value="pickup" data-testid="cleaner-city-tab-pickup" className="gap-1.5">
                {pickupDone && <Check size={12} className="text-emerald-500" />}
                Home gate
              </TabsTrigger>
            </TabsList>

            <TabsContent value="office" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm font-semibold">Private office pin</p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Exact office stays owner-private until a confirmed booking grants limited access.
                </p>
              </div>

              <CleanerCityPinPicker
                title="Office location"
                hint="Search or move the map under the blue pin"
                value={office}
                onChange={setOffice}
                testId="cleaner-city-office-pin"
              />
              <div className="flex flex-col gap-3">
                <Button
                  className="h-12 w-full font-semibold"
                  onClick={saveOffice}
                  disabled={upsertOffice.isPending}
                  data-testid="cleaner-city-office-save"
                >
                  {officeDone ? 'Update office pin' : 'Save office pin'}
                </Button>
                {officeDone && (
                  <button
                    type="button"
                    className="py-1 text-center text-sm font-semibold text-primary"
                    onClick={() => setTab('pickup')}
                  >
                    Next - home gate
                  </button>
                )}
              </div>
              </div>
            </TabsContent>

            <TabsContent value="pickup" className="mt-6 focus-visible:outline-none" data-testid="cleaner-city-pickup-section">
              <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <MapPinned size={18} className="text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Usual home / society gate</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      One pin for Mon-Fri. Most people leave from the same gate every workday - times change, the gate usually does not.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2" data-testid="cleaner-city-pickup-coverage">
                  {WORK_WEEK.map((d) => {
                    const covered = daysWithPickup.includes(d);
                    const label = CLEANER_CITY_WEEKDAYS.find((w) => w.value === d)?.label || String(d);
                    return (
                      <span
                        key={d}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                          covered
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {covered && <Check size={11} />}
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

              {office && pickup ? (
                <div
                  className="rounded-2xl border border-border bg-card p-4 space-y-3"
                  data-testid="cleaner-city-route-choice"
                >
                  <div>
                    <p className="text-sm font-semibold">Which road will you take?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {loadingRoutes
                        ? 'Loading Google driving options…'
                        : routeAlts.length > 1
                          ? 'Google found more than one path - pick the one you drive.'
                          : 'One driving path for these pins.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {routeAlts.map((alt) => {
                      const mins = Math.round(alt.durationSeconds / 60);
                      const km = (alt.distanceMeters / 1000).toFixed(1);
                      const selected = selectedRouteId === alt.id;
                      return (
                        <button
                          key={alt.id}
                          type="button"
                          onClick={() => setSelectedRouteId(alt.id)}
                          className={cn(
                            'rounded-xl border px-3.5 py-3 text-left',
                            selected
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/40',
                          )}
                          data-testid={`cleaner-city-route-alt-${alt.id}`}
                        >
                          <p className="text-sm font-semibold flex items-center gap-1.5">
                            {selected ? <Check size={14} className="text-primary" /> : null}
                            {alt.summary}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ~{mins} min · {km} km
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  className="h-12 w-full font-semibold"
                  onClick={saveUsualWorkWeekPickup}
                  disabled={
                    setTemplate.isPending ||
                    savingWeek ||
                    (office && routeAlts.length > 1 && !selectedRoute)
                  }
                  data-testid="cleaner-city-pickup-save-week"
                >
                  {savingWeek ? 'Saving Mon-Fri…' : 'Save usual pickup for Mon-Fri'}
                </Button>
              </div>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground"
                onClick={() => setShowDayOverride((v) => !v)}
                data-testid="cleaner-city-pickup-override-toggle"
              >
                <span>Different gate on one day? (rare)</span>
                <ChevronDown size={14} className={cn('transition-transform', showDayOverride && 'rotate-180')} />
              </button>

              {showDayOverride && (
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Example: Tue you leave from parents&apos; place. Other days keep the usual pin.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CLEANER_CITY_WEEKDAYS.map((w) => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => setOverrideDay(w.value)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-semibold',
                          overrideDay === w.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border',
                        )}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={savePickupForOneDay}
                    disabled={setTemplate.isPending}
                    data-testid="cleaner-city-pickup-save-day"
                  >
                    Save override for this day only
                  </Button>
                </div>
              )}

              {pickupDone ? (
                <button
                  type="button"
                  className="py-1 text-center text-sm font-semibold text-primary"
                  data-testid="cleaner-city-route-next"
                  onClick={() =>
                    navigate('/cleaner-city/schedule', {
                      state: {
                        notice:
                          'Leave and return times change day to day. Your home gate usually does not.',
                      },
                    })
                  }
                >
                  Next - weekly schedule
                </button>
              ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
