// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Check, MapPinned, Route } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { CleanerCityRoutePreview } from '@/components/cleaner-city/CleanerCityRoutePreview';
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
  fetchDrivingRouteAlternatives,
  savePreferredRoute,
  type RouteAlternative,
} from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Pin = { lat: number; lng: number; label: string; address?: string };
type Direction = 'to_office' | 'to_home';

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
  onSaved?: (info: { officeDone: boolean; pickupDone: boolean; toOffice: boolean; toHome: boolean }) => void;
  className?: string;
};

export function CleanerCityRouteSetupPanel({ compact, onSaved, className }: Props) {
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
  const [acceptApprox, setAcceptApprox] = useState(false);
  const [savingOffice, setSavingOffice] = useState(false);
  const [savingPickup, setSavingPickup] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);

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

  const routeOrigin = direction === 'to_office' ? pickup : office;
  const routeDest = direction === 'to_office' ? office : pickup;

  useEffect(() => {
    if (!routeOrigin || !routeDest) {
      setRouteAlts([]);
      setSelectedRouteId(null);
      setRouteFetchError(null);
      return;
    }
    if (!isLoaded) {
      setRouteFetchError('Google Maps is still loading. Wait a moment, then try again.');
      setRouteAlts([]);
      setSelectedRouteId(null);
      return;
    }
    let cancelled = false;
    setLoadingRoutes(true);
    setRouteFetchError(null);
    setAcceptApprox(false);
    setSelectedRouteId(null);
    void fetchDrivingRouteAlternatives(routeOrigin, routeDest)
      .then((alts) => {
        if (cancelled) return;
        setRouteAlts(alts);
        const onlyApprox =
          alts.length > 0 && alts.every((a) => a.provider === 'haversine_fallback');
        if (onlyApprox) {
          setRouteFetchError(
            'Google Directions is unavailable. You can save an approximate straight path only after confirming below - matching will be weaker until a real road is chosen.',
          );
        } else if (alts.length === 0) {
          setRouteFetchError('No driving paths found for these pins.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRouteAlts([]);
        setRouteFetchError(
          'Could not load Google driving options. Check your connection, then retry.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingRoutes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeOrigin?.lat, routeOrigin?.lng, routeDest?.lat, routeDest?.lng, direction, isLoaded]);

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
      toast.success('Office pin saved');
      emitProgress();
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
      toast.success('Home gate saved for Mon-Fri');
      emitProgress();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save pickup');
    } finally {
      setSavingPickup(false);
    }
  };

  const saveChosenRoad = async () => {
    if (!user?.id || !routeOrigin || !routeDest) {
      toast.error('Save office and home gate pins first');
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
    } catch (e: any) {
      toast.error(e?.message || 'Could not save preferred road');
    } finally {
      setSavingRoute(false);
    }
  };

  return (
    <div
      className={cn('space-y-5', className)}
      data-testid="cleaner-city-route-setup-panel"
    >
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm font-semibold">Office & usual roads</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Pin office and home gate, then tap the Google road you actually drive - morning and evening.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span
            className={cn(
              'rounded-full border px-2.5 py-1 text-[10px] font-bold',
              officeDone
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                : 'border-border text-muted-foreground',
            )}
          >
            {officeDone ? 'Office set' : 'Office needed'}
          </span>
          <span
            className={cn(
              'rounded-full border px-2.5 py-1 text-[10px] font-bold',
              pickupDone
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                : 'border-border text-muted-foreground',
            )}
          >
            {pickupDone ? 'Home gate set' : 'Home gate needed'}
          </span>
          <span
            className={cn(
              'rounded-full border px-2.5 py-1 text-[10px] font-bold',
              savedToOffice
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                : 'border-border text-muted-foreground',
            )}
            data-testid="cleaner-city-usual-route-to-office"
          >
            {savedToOffice ? `To office · ${savedToOffice.summary}` : 'Morning road needed'}
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
            {savedToHome ? `To home · ${savedToHome.summary}` : 'Evening road needed'}
          </span>
        </div>
      </div>

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
          : officeDone
            ? 'Update office pin'
            : 'Save office pin'}
      </Button>

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
        {savingPickup || setTemplate.isPending ? 'Saving Mon-Fri…' : 'Save usual pickup for Mon-Fri'}
      </Button>

      {office && pickup ? (
        <div
          className="rounded-2xl border border-border bg-card p-4 space-y-3"
          data-testid="cleaner-city-route-choice"
        >
          <div className="flex items-start gap-2">
            <Route size={16} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Choose your usual road</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tap a Google option so matching follows the same path you drive.
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
              </button>
            ))}
          </div>

          {loadingRoutes ? (
            <p className="text-xs text-muted-foreground">Loading Google driving options…</p>
          ) : null}

          {routeFetchError ? (
            <div
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
              data-testid="cleaner-city-route-offline-notice"
            >
              {routeFetchError}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {routeAlts.map((alt) => {
              const selected = selectedRouteId === alt.id;
              return (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => setSelectedRouteId(alt.id)}
                  className={cn(
                    'rounded-xl border px-3.5 py-3 text-left',
                    selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40',
                  )}
                  data-testid={`cleaner-city-route-alt-${alt.id}`}
                >
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {selected ? <Check size={14} className="text-primary" /> : null}
                    {alt.summary}
                    {alt.provider === 'haversine_fallback' ? (
                      <span className="text-[10px] font-bold uppercase text-amber-700">Approx</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatRouteMeta(alt)}</p>
                </button>
              );
            })}
          </div>

          {selectedRoute ? (
            <CleanerCityRoutePreview
              path={selectedRoute.path}
              polyline={selectedRoute.polyline}
              testId="cleaner-city-route-choice-preview"
            />
          ) : null}

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

          {!compact ? (
            <p className="text-[11px] text-muted-foreground">
              Switch to the other direction and save that road too before you finish setup.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground px-1">
          Save both office and home gate pins to unlock Google road choices.
        </p>
      )}
    </div>
  );
}
