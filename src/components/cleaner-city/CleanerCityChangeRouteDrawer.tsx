// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, X } from 'lucide-react';
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
import { CleanerCityRoutePreview } from '@/components/cleaner-city/CleanerCityRoutePreview';
import {
  useEnsureHostPublication,
  useSetPreferredRoute,
  useStoreRouteGeometry,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import {
  fetchDrivingRouteAlternativesDetailed,
  savePreferredRoute,
  type RouteAlternative,
} from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Direction = 'to_office' | 'to_home';

type Pin = { lat: number; lng: number; label?: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  direction: Direction;
  home: Pin | null;
  office: Pin | null;
  homeLabel?: string | null;
  officeLabel?: string | null;
  /** Live offer for this date+direction, if any. */
  publicationId?: string | null;
  /** When true and no publication yet, ensure seats open on the chosen road. */
  ensureIfGoing?: boolean;
  onConfirmed?: (info: { direction: Direction; summary: string }) => void;
};

function kmLabel(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  return `${(meters / 1000).toFixed(1)} km`;
}

function altTitle(alt: RouteAlternative, index: number) {
  const km = kmLabel(alt.distanceMeters);
  const name = index === 0 ? 'Preferred Route' : `Route ${index}`;
  return km ? `${km} ${name}` : name;
}

/**
 * HOPR-style drawer: pick Going/Return road alternatives and confirm.
 * Saves preferred route for that direction and updates that day's live offer geometry.
 */
export function CleanerCityChangeRouteDrawer({
  open,
  onOpenChange,
  date,
  direction,
  home,
  office,
  homeLabel,
  officeLabel,
  publicationId,
  ensureIfGoing = true,
  onConfirmed,
}: Props) {
  const { user } = useAuth();
  const { isLoaded } = useGoogleMaps();
  const setPreferred = useSetPreferredRoute();
  const storeRoute = useStoreRouteGeometry();
  const ensurePub = useEnsureHostPublication();

  const [alts, setAlts] = useState<RouteAlternative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const origin = direction === 'to_office' ? home : office;
  const destination = direction === 'to_office' ? office : home;
  const destLabel =
    direction === 'to_office'
      ? officeLabel || office?.label || 'Office'
      : homeLabel || home?.label || 'Home';

  const selected = useMemo(
    () => alts.find((a) => a.id === selectedId) || alts[0] || null,
    [alts, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    if (!origin || !destination) {
      setAlts([]);
      setSelectedId(null);
      setError('Set home and office pins on Route first.');
      return;
    }
    if (!isLoaded) {
      setError('Google Maps is still loading. Wait a moment, then tap Retry.');
      setAlts([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    void fetchDrivingRouteAlternativesDetailed(origin, destination)
      .then((packed) => {
        if (cancelled) return;
        setAlts(packed.alternatives);
        if (!packed.googleOk && packed.message) setError(packed.message);
        else if (packed.alternatives.length === 0) {
          setError('No driving paths found for these pins.');
        }
        if (packed.alternatives[0]) setSelectedId(packed.alternatives[0].id);
      })
      .catch(() => {
        if (cancelled) return;
        setAlts([]);
        setError('Could not load route options. Check your connection, then tap Retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    direction,
    isLoaded,
    retryKey,
  ]);

  const confirmLabel =
    direction === 'to_home' ? 'Confirm Return Route' : 'Confirm Going Route';

  const confirm = async () => {
    if (!selected || !origin || !destination || !user?.id) {
      toast.error('Pick a route first');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        polyline: selected.polyline,
        distanceMeters: selected.distanceMeters,
        durationSeconds: selected.durationSeconds,
        summary: selected.summary || altTitle(selected, alts.indexOf(selected)),
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: destination.lat,
        destLng: destination.lng,
        savedAt: new Date().toISOString(),
      };
      savePreferredRoute(user.id, payload, direction);
      await setPreferred.mutateAsync({
        ...payload,
        direction,
      });

      if (publicationId) {
        await storeRoute.mutateAsync({
          publication_id: publicationId,
          route_polyline: selected.polyline,
          origin_latitude: origin.lat,
          origin_longitude: origin.lng,
          destination_latitude: destination.lat,
          destination_longitude: destination.lng,
          origin_label: direction === 'to_office' ? homeLabel || 'Home' : officeLabel || 'Office',
          destination_label: destLabel,
          route_distance_meters: selected.distanceMeters,
          route_duration_seconds: selected.durationSeconds,
          route_provider: selected.provider || 'google',
        });
      } else if (ensureIfGoing) {
        try {
          await ensurePub.mutateAsync({
            travel_date: date,
            direction,
            route_polyline: selected.polyline,
          });
        } catch {
          // Preferred road is saved; seats may open once Going / vehicle is ready.
        }
      }

      toast.success(
        direction === 'to_home' ? 'Return route updated' : 'Going route updated',
      );
      onConfirmed?.({
        direction,
        summary: payload.summary,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save route');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        className="max-h-[92vh] rounded-t-[1.35rem] border-border bg-background"
        data-testid="cleaner-city-change-route-drawer"
        data-direction={direction}
      >
        <DrawerHeader className="relative px-5 pb-1 pt-1">
          <DrawerTitle className="pr-10 text-center text-[16px] font-extrabold tracking-tight">
            Change route
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

        <div className="max-h-[68vh] space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <div className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <MapPin size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-foreground">
              To {destLabel}
            </p>
          </div>

          {selected ? (
            <CleanerCityRoutePreview
              path={selected.path}
              polyline={selected.polyline}
              alternatives={alts}
              selectedId={selected.id}
              onSelect={setSelectedId}
              className="h-36 overflow-hidden rounded-xl border border-border"
              testId="cleaner-city-change-route-preview"
            />
          ) : null}

          {loading ? (
            <p className="py-4 text-center text-[12px] text-muted-foreground">
              Loading route options…
            </p>
          ) : null}

          {error ? (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
              <p className="text-[12px] text-amber-950 dark:text-amber-50">{error}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-[11px]"
                  onClick={() => setRetryKey((n) => n + 1)}
                >
                  Retry
                </Button>
                <Button asChild type="button" size="sm" variant="ghost" className="h-8 text-[11px]">
                  <Link to="/cleaner-city/route" onClick={() => onOpenChange(false)}>
                    Open Route setup
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2" role="radiogroup" aria-label="Route options">
            {alts.map((alt, index) => {
              const active = selectedId === alt.id;
              return (
                <button
                  key={alt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelectedId(alt.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                  data-testid={`cleaner-city-change-route-alt-${index}`}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">
                      {altTitle(alt, index)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {alt.summary}
                      {alt.durationSeconds
                        ? ` · ~${Math.max(1, Math.round(alt.durationSeconds / 60))} min`
                        : ''}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      active ? 'border-primary' : 'border-muted-foreground/40',
                    )}
                  >
                    {active ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DrawerFooter className="px-5 pb-5 pt-2">
          <Button
            type="button"
            className="h-11 w-full rounded-xl text-[14px] font-bold"
            disabled={!selected || saving || loading}
            onClick={() => void confirm()}
            data-testid="cleaner-city-change-route-confirm"
          >
            {saving ? 'Saving…' : confirmLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
