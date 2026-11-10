// @ts-nocheck
import { Link } from 'react-router-dom';
import { Bike, Car, X } from 'lucide-react';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import { CleanerCityWeeklyPlanCard } from '@/components/cleaner-city/CleanerCityWeeklyPlanCard';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { cn } from '@/lib/utils';

export type OfferSetupDrawerMode = 'vehicle' | 'path' | 'week' | 'meeting' | null;

type VehicleLike = {
  id: string;
  vehicle_type: string;
  registration_number?: string | null;
  seat_capacity?: number | null;
};

type MeetupLike = {
  id: string;
  label: string;
  kind?: string | null;
};

type Props = {
  mode: OfferSetupDrawerMode;
  onOpenChange: (open: boolean) => void;
  vehicleKind: 'bike' | 'car';
  onVehicleKind: (kind: 'bike' | 'car') => void;
  vehicleId: string;
  onVehicleId: (id: string) => void;
  kindVehicles: VehicleLike[];
  meetupPoints?: MeetupLike[];
  meetingPoint?: string | null;
  onSelectMeetingPoint?: (label: string) => void | Promise<void>;
  onDone?: () => void;
  onWeekSaved?: (info: { depart: string; returnTime: string; officeDays: number[] }) => void;
};

const TITLES: Record<Exclude<OfferSetupDrawerMode, null>, string> = {
  vehicle: 'Edit vehicle',
  path: 'Edit path',
  week: 'Edit planned rides',
  meeting: 'Choose meeting point',
};

const MEETING_PRESETS = [
  'Society gate',
  'Tower gate',
  'Clubhouse',
  'Parking',
  'Main road',
] as const;

export function CleanerCityOfferSetupDrawer({
  mode,
  onOpenChange,
  vehicleKind,
  onVehicleKind,
  vehicleId,
  onVehicleId,
  kindVehicles,
  meetupPoints = [],
  meetingPoint,
  onSelectMeetingPoint,
  onDone,
  onWeekSaved,
}: Props) {
  const open = !!mode;
  const title = mode ? TITLES[mode] : '';
  const currentMeeting = String(meetingPoint || 'Society gate').trim() || 'Society gate';

  const close = () => onOpenChange(false);

  const pickMeeting = async (label: string) => {
    await onSelectMeetingPoint?.(label);
    close();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
      shouldScaleBackground={false}
    >
      <DrawerContent
        className="max-h-[90vh] rounded-t-[1.35rem] border-black/5 bg-[#F7F5F1]"
        data-testid="cleaner-city-offer-setup-drawer"
        data-mode={mode || undefined}
      >
        <DrawerHeader className="relative px-5 pb-2 pt-1">
          <DrawerTitle className="pr-10 text-center text-[16px] font-semibold tracking-tight">
            {title}
          </DrawerTitle>
          <DrawerClose asChild>
            <button
              type="button"
              className="absolute right-4 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-muted-foreground"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </DrawerClose>
        </DrawerHeader>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto px-5 pb-2">
          {mode === 'vehicle' ? (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">
                Pick the vehicle you will publish seats with.
              </p>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Vehicle type
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onVehicleKind('bike')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-semibold',
                      vehicleKind === 'bike'
                        ? 'border-[#0F3D2E] bg-[#E8F2EC] text-[#0F3D2E]'
                        : 'border-black/10 bg-white text-foreground',
                    )}
                  >
                    <Bike className="h-4 w-4" />
                    Two-wheeler
                  </button>
                  <button
                    type="button"
                    onClick={() => onVehicleKind('car')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-semibold',
                      vehicleKind === 'car'
                        ? 'border-[#0F3D2E] bg-[#E8F2EC] text-[#0F3D2E]'
                        : 'border-black/10 bg-white text-foreground',
                    )}
                  >
                    <Car className="h-4 w-4" />
                    Four-wheeler
                  </button>
                </div>
                <select
                  className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-[13px] text-foreground"
                  value={vehicleId}
                  onChange={(e) => onVehicleId(e.target.value)}
                  data-testid="cleaner-city-offer-drawer-vehicle"
                >
                  {kindVehicles.length === 0 && <option value="">No active vehicle</option>}
                  {kindVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {String(v.vehicle_type || '').toUpperCase()} · {v.registration_number} ·{' '}
                      {v.seat_capacity} seats
                    </option>
                  ))}
                </select>
                {kindVehicles.length === 0 ? (
                  <Link
                    to="/cleaner-city/vehicle"
                    onClick={close}
                    className={cn(cc.primaryBtn, 'w-full')}
                  >
                    Add a vehicle
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {mode === 'path' ? (
            <div className="space-y-2">
              <CleanerCityRouteSetupPanel
                compact
                quiet
                onSaved={() => {
                  /* stay in drawer until Done */
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Full map on{' '}
                <Link
                  to="/cleaner-city/route"
                  className={cn('font-semibold', cc.forestText)}
                  onClick={close}
                >
                  Route
                </Link>
                .
              </p>
            </div>
          ) : null}

          {mode === 'week' ? (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground">
                Office days and usual leave times for the week.
              </p>
              <CleanerCityWeeklyPlanCard
                compact
                onSaved={(info) => {
                  onWeekSaved?.(info);
                }}
              />
            </div>
          ) : null}

          {mode === 'meeting' ? (
            <div className="space-y-3" data-testid="cleaner-city-offer-meeting-picker">
              <p className="text-[12px] text-muted-foreground">
                Where neighbours walk to meet you. This is not your home pin - keep it on your usual
                road.
              </p>
              <div className="flex flex-wrap gap-2">
                {MEETING_PRESETS.map((label) => {
                  const active = currentMeeting.toLowerCase() === label.toLowerCase();
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void pickMeeting(label)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition',
                        active
                          ? 'border-[#0F3D2E] bg-[#E8F2EC] text-[#0F3D2E]'
                          : 'border-black/10 bg-white text-foreground',
                      )}
                      data-testid={`cleaner-city-offer-meeting-preset-${label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {meetupPoints.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Society spots
                  </p>
                  {meetupPoints.map((spot) => {
                    const active =
                      currentMeeting.toLowerCase() === String(spot.label || '').toLowerCase();
                    return (
                      <button
                        key={spot.id}
                        type="button"
                        onClick={() => void pickMeeting(spot.label)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold',
                          active
                            ? 'border-[#0F3D2E] bg-[#E8F2EC] text-[#0F3D2E]'
                            : 'border-black/10 bg-white text-foreground',
                        )}
                        data-testid={`cleaner-city-offer-meeting-spot-${spot.id}`}
                      >
                        <span className="truncate">{spot.label}</span>
                        {spot.kind ? (
                          <span className="ml-2 shrink-0 text-[11px] font-medium text-muted-foreground">
                            {spot.kind}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DrawerFooter className="border-t border-black/5 bg-[#F7F5F1] px-5 pb-5 pt-3">
          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            onClick={() => {
              onDone?.();
              close();
            }}
            data-testid="cleaner-city-offer-setup-done"
          >
            Done
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
