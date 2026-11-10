import type { CommuteProfile, CommuteTemplate, OfficeLocation } from '@/hooks/queries/useCleanerCity';
import { preferredRouteFromProfile } from '@/hooks/queries/useCleanerCity';

type VehicleLike = { is_active?: boolean | null };

/** Host readiness for default Auto-offer: vehicle + pins + road + leave times. */
export function isHostDiscoverabilityReady(input: {
  profile: CommuteProfile | null | undefined;
  templates: CommuteTemplate[] | null | undefined;
  offices: OfficeLocation[] | null | undefined;
  vehicles: VehicleLike[] | null | undefined;
}): boolean {
  const { profile, templates = [], offices = [], vehicles = [] } = input;
  if (!profile) return false;
  if (profile.role !== 'host' && profile.role !== 'both') return false;
  if (profile.is_paused) return false;

  const hasVehicle = (vehicles || []).some((v) => v.is_active !== false);
  if (!hasVehicle) return false;

  const hasOffice = (offices || []).some(
    (o) => typeof o.latitude === 'number' && typeof o.longitude === 'number',
  );
  if (!hasOffice) return false;

  const hasHomePin = (templates || []).some(
    (t) =>
      typeof t.pickup_latitude === 'number' &&
      typeof t.pickup_longitude === 'number' &&
      Number.isFinite(t.pickup_latitude) &&
      Number.isFinite(t.pickup_longitude),
  );
  if (!hasHomePin) return false;

  const hasWorkingDay = (templates || []).some(
    (t) => t.is_working && (!!t.depart_time || !!t.return_time),
  );
  if (!hasWorkingDay) return false;

  // At least one usual road (morning is enough to start discoverability).
  if (!preferredRouteFromProfile(profile, 'to_office')) return false;

  return true;
}

export function shouldEnableDefaultAutopilot(profile: CommuteProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.autopilot_enabled) return false;
  if (profile.autopilot_default_applied) return false;
  return true;
}
