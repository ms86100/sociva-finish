// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { Button } from '@/components/ui/button';
import {
  useCleanerCityProfile,
  useOfficeLocations,
  useSetCommuteTemplate,
  useCommuteTemplates,
  useUpsertOfficeLocation,
} from '@/hooks/queries/useCleanerCity';
import { CLEANER_CITY_WEEKDAYS } from '@/lib/cleaner-city/constants';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { fetchDrivingRoute } from '@/lib/cleaner-city/routing';

type Pin = { lat: number; lng: number; label: string; address?: string };

export default function CleanerCityRoutePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const upsertOffice = useUpsertOfficeLocation();
  const setTemplate = useSetCommuteTemplate();
  const { isLoaded } = useGoogleMaps();

  const primary = offices.find((o) => o.is_primary) || offices[0] || null;
  const [office, setOffice] = useState<Pin | null>(null);
  const [pickup, setPickup] = useState<Pin | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);

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
    const t = templates.find((x) => x.weekday === weekday);
    if (t?.pickup_label) {
      setPickup((prev) =>
        prev || {
          lat: 12.9716,
          lng: 77.5946,
          label: t.pickup_label || 'Pickup',
        },
      );
    }
  }, [weekday, templates]);

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
      toast.success('Office pin saved (private to you)');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save office');
    }
  };

  const savePickupForDay = async () => {
    if (!pickup) {
      toast.error('Pin a pickup point');
      return;
    }
    const existing = templates.find((t) => t.weekday === weekday);
    try {
      await setTemplate.mutateAsync({
        weekday,
        is_working: existing?.is_working ?? true,
        depart_time: existing?.depart_time || '08:30',
        return_time: existing?.return_time || '18:30',
        pickup_label: pickup.label,
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
      });
      toast.success(`Pickup saved for ${CLEANER_CITY_WEEKDAYS.find((w) => w.value === weekday)?.full}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save pickup');
    }
  };

  const previewRoute = async () => {
    if (!office || !pickup) {
      toast.error('Set both office and pickup pins');
      return;
    }
    if (!isLoaded) {
      toast.message('Maps still loading - using approximate path');
    }
    try {
      const route = await fetchDrivingRoute(pickup, office);
      const mins = Math.round(route.durationSeconds / 60);
      const km = (route.distanceMeters / 1000).toFixed(1);
      setPreview(`${km} km · ~${mins} min (${route.provider})`);
      toast.success('Route preview ready');
    } catch (e: any) {
      toast.error(e?.message || 'Could not preview route');
    }
  };

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
        <div className="p-4 pb-24 space-y-5" data-testid="cleaner-city-route-page">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">Private office pin</p>
            <p className="text-xs text-muted-foreground mt-1">
              Exact office stays owner-private until a confirmed booking grants limited access.
            </p>
          </div>

          <CleanerCityPinPicker
            title="Office location"
            hint="Search or tap the map"
            value={office}
            onChange={setOffice}
            testId="cleaner-city-office-pin"
          />
          <Button onClick={saveOffice} disabled={upsertOffice.isPending} data-testid="cleaner-city-office-save">
            Save office pin
          </Button>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Weekday pickup pin</p>
            <div className="flex flex-wrap gap-2">
              {CLEANER_CITY_WEEKDAYS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => setWeekday(w.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    weekday === w.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <CleanerCityPinPicker
              title="Pickup near home / society"
              hint="Used for matching corridor labels"
              value={pickup}
              onChange={setPickup}
              testId="cleaner-city-pickup-pin"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={savePickupForDay}
                disabled={setTemplate.isPending}
              >
                Save pickup for day
              </Button>
              <Button type="button" variant="ghost" onClick={previewRoute}>
                Preview route
              </Button>
            </div>
            {preview && <p className="text-xs text-muted-foreground">{preview}</p>}
          </div>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
