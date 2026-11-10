// @ts-nocheck
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { functionInvokeErrorMessage } from '@/lib/function-invoke-error';

export type CommuteProfile = {
  id: string;
  user_id: string;
  society_id: string;
  role: 'host' | 'guest' | 'both';
  transport_preference: 'car' | 'bike' | 'looking';
  company_name: string | null;
  is_paused: boolean;
  deleted_at: string | null;
  timezone?: string | null;
  autopilot_enabled?: boolean;
  autopilot_confirm_mode?: 'confirm' | 'auto';
  /** True once default Auto-offer was applied or user toggled Auto-offer. */
  autopilot_default_applied?: boolean;
  circle_only_matching?: boolean;
  /** Ranking boost for circle mates; does not hide from society Find. */
  prefer_circle_matching?: boolean;
  circle_visibility?: 'members' | 'private';
  show_on_circle_board?: boolean;
  require_circle_history?: boolean;
  open_city_matching?: boolean;
  preferred_route_polyline?: string | null;
  preferred_route_distance_meters?: number | null;
  preferred_route_duration_seconds?: number | null;
  preferred_route_summary?: string | null;
  preferred_route_origin_lat?: number | null;
  preferred_route_origin_lng?: number | null;
  preferred_route_dest_lat?: number | null;
  preferred_route_dest_lng?: number | null;
  preferred_route_saved_at?: string | null;
  preferred_return_route_polyline?: string | null;
  preferred_return_route_distance_meters?: number | null;
  preferred_return_route_duration_seconds?: number | null;
  preferred_return_route_summary?: string | null;
  preferred_return_route_origin_lat?: number | null;
  preferred_return_route_origin_lng?: number | null;
  preferred_return_route_dest_lat?: number | null;
  preferred_return_route_dest_lng?: number | null;
  preferred_return_route_saved_at?: string | null;
};

export type WorkVerification = {
  id: string;
  email: string;
  status: string;
  verified_at: string | null;
  expires_at: string | null;
};

export type CommuteTemplate = {
  id: string;
  weekday: number;
  is_working: boolean;
  depart_time: string | null;
  return_time: string | null;
  pickup_label: string | null;
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
};

export type CommuteOverride = {
  id: string;
  override_date: string;
  is_working: boolean;
  depart_time: string | null;
  return_time: string | null;
  override_kind: string;
  note: string | null;
  pickup_label: string | null;
};

export type EffectiveSchedule = {
  date: string;
  source: 'paused' | 'override' | 'template' | 'none';
  is_working: boolean;
  is_paused: boolean;
  timezone?: string;
  depart_time?: string | null;
  return_time?: string | null;
  pickup_label?: string | null;
  override_kind?: string | null;
  note?: string | null;
  weekday?: number;
  role?: string;
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
  autopilot_enabled?: boolean;
  autopilot_confirm_mode?: 'confirm' | 'auto';
};

function invalidateSchedule(queryClient: ReturnType<typeof useQueryClient>, userId?: string) {
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-templates', userId] });
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-overrides', userId] });
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-effective'] });
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', userId] });
}

export function useCleanerCityProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-profile', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_profiles')
        .select('*')
        .eq('user_id', user!.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data as CommuteProfile | null;
    },
  });
}

export function useCleanerCityWorkVerification() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-work-verification', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_verifications')
        .select('id, email, status, verified_at, expires_at')
        .eq('user_id', user!.id)
        .eq('status', 'verified')
        .maybeSingle();
      if (error) throw error;
      return data as WorkVerification | null;
    },
  });
}

export function preferredRouteFromProfile(
  profile: CommuteProfile | null | undefined,
  direction: 'to_office' | 'to_home' = 'to_office',
): {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  summary: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  savedAt: string;
} | null {
  if (direction === 'to_home') {
    if (
      !profile?.preferred_return_route_polyline ||
      profile.preferred_return_route_origin_lat == null ||
      profile.preferred_return_route_origin_lng == null ||
      profile.preferred_return_route_dest_lat == null ||
      profile.preferred_return_route_dest_lng == null
    ) {
      return null;
    }
    return {
      polyline: profile.preferred_return_route_polyline,
      distanceMeters: profile.preferred_return_route_distance_meters || 0,
      durationSeconds: profile.preferred_return_route_duration_seconds || 0,
      summary: profile.preferred_return_route_summary || 'Saved road home',
      originLat: profile.preferred_return_route_origin_lat,
      originLng: profile.preferred_return_route_origin_lng,
      destLat: profile.preferred_return_route_dest_lat,
      destLng: profile.preferred_return_route_dest_lng,
      savedAt: profile.preferred_return_route_saved_at || new Date().toISOString(),
    };
  }
  if (
    !profile?.preferred_route_polyline ||
    profile.preferred_route_origin_lat == null ||
    profile.preferred_route_origin_lng == null ||
    profile.preferred_route_dest_lat == null ||
    profile.preferred_route_dest_lng == null
  ) {
    return null;
  }
  return {
    polyline: profile.preferred_route_polyline,
    distanceMeters: profile.preferred_route_distance_meters || 0,
    durationSeconds: profile.preferred_route_duration_seconds || 0,
    summary: profile.preferred_route_summary || 'Saved road',
    originLat: profile.preferred_route_origin_lat,
    originLng: profile.preferred_route_origin_lng,
    destLat: profile.preferred_route_dest_lat,
    destLng: profile.preferred_route_dest_lng,
    savedAt: profile.preferred_route_saved_at || new Date().toISOString(),
  };
}

export function useSetPreferredRoute() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      polyline: string;
      distanceMeters: number;
      durationSeconds: number;
      summary: string;
      originLat: number;
      originLng: number;
      destLat: number;
      destLng: number;
      direction?: 'to_office' | 'to_home';
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_preferred_route', {
        p_polyline: input.polyline,
        p_distance_meters: input.distanceMeters,
        p_duration_seconds: input.durationSeconds,
        p_summary: input.summary,
        p_origin_lat: input.originLat,
        p_origin_lng: input.originLng,
        p_dest_lat: input.destLat,
        p_dest_lng: input.destLng,
        p_direction: input.direction || 'to_office',
      });
      if (error) throw error;
      return data as CommuteProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', user?.id] });
    },
  });
}

export function useSetPublicationDropOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    meta: { suppressGlobalErrorToast: true },
    mutationFn: async (input: { publication_id: string; drop_order: unknown }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_publication_drop_order', {
        p_publication_id: input.publication_id,
        p_drop_order: input.drop_order,
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: (_data, vars) => {
      // Do not invalidate the open ride aggressively - re-plan races wipe Arrived progress.
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
      queryClient.invalidateQueries({
        queryKey: ['cleaner-city-publication-rides', vars.publication_id],
      });
    },
  });
}

export function useUpsertCommuteProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      role: string;
      transport_preference: string;
      company_name?: string | null;
      is_paused?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_commute_profile', {
        p_role: input.role,
        p_transport_preference: input.transport_preference,
        p_company_name: input.company_name ?? null,
        p_is_paused: input.is_paused ?? false,
      });
      if (error) throw error;
      return data as CommuteProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', user?.id] });
    },
  });
}

export function useWorkEmailOtp() {
  const queryClient = useQueryClient();

  const send = useMutation({
    mutationFn: async (email: string) => {
      const result = await supabase.functions.invoke('cleaner-city-work-email-otp', {
        body: { action: 'send', email },
      });
      const message = await functionInvokeErrorMessage(
        result,
        'Could not send verification code. Check your work email domain and try again.',
      );
      if (result.error || result.data?.error) throw new Error(message);
      return result.data;
    },
  });

  const verify = useMutation({
    mutationFn: async (input: { email: string; code: string }) => {
      const result = await supabase.functions.invoke('cleaner-city-work-email-otp', {
        body: { action: 'verify', email: input.email, code: input.code },
      });
      const message = await functionInvokeErrorMessage(
        result,
        'Invalid or expired code. Request a new one if needed.',
      );
      if (result.error || result.data?.error) throw new Error(message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-work-verification'] });
    },
  });

  return { send, verify };
}

export type ApprovedCompanyDomain = { domain: string; company_name: string };

export function useApprovedCompanyDomains() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-approved-domains', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_list_approved_domains');
      if (error) throw error;
      return (data || []) as ApprovedCompanyDomain[];
    },
  });
}

export function useCheckWorkEmailDomain(email: string) {
  const { user } = useAuth();
  const trimmed = email.trim().toLowerCase();
  return useQuery({
    queryKey: ['cleaner-city-check-domain', user?.id, trimmed],
    enabled: !!user?.id && trimmed.includes('@') && trimmed.length > 5,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_check_work_email_domain', {
        p_email: trimmed,
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        code: string;
        message: string;
        domain?: string;
        company_name?: string;
      };
    },
  });
}

export function useRequestCompanyDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { domain: string; company_name: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_request_company_domain', {
        p_domain: input.domain,
        p_company_name: input.company_name,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-approved-domains'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-check-domain'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-domains'] });
    },
  });
}

export function useCommuteTemplates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-templates', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_templates')
        .select(
          'id, weekday, is_working, depart_time, return_time, pickup_label, pickup_latitude, pickup_longitude',
        )
        .eq('user_id', user!.id)
        .order('weekday');
      if (error) throw error;
      return (data || []) as CommuteTemplate[];
    },
  });
}

export function useCommuteOverrides(fromDate?: string, toDate?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-overrides', user?.id, fromDate, toDate],
    enabled: !!user?.id,
    queryFn: async () => {
      let q = supabase
        .from('commute_overrides')
        .select('id, override_date, is_working, depart_time, return_time, override_kind, note, pickup_label')
        .eq('user_id', user!.id)
        .order('override_date');
      if (fromDate) q = q.gte('override_date', fromDate);
      if (toDate) q = q.lte('override_date', toDate);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as CommuteOverride[];
    },
  });
}

export function useEffectiveSchedule(date: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-effective', user?.id, date],
    enabled: !!user?.id && !!date,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_effective_schedule', {
        p_user_id: user!.id,
        p_date: date,
      });
      if (error) throw error;
      return data as EffectiveSchedule;
    },
  });
}

export function useSetCommuteTemplate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      weekday: number;
      is_working: boolean;
      depart_time?: string | null;
      return_time?: string | null;
      pickup_label?: string | null;
      pickup_latitude?: number | null;
      pickup_longitude?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_commute_template', {
        p_weekday: input.weekday,
        p_is_working: input.is_working,
        p_depart_time: input.is_working ? input.depart_time ?? null : null,
        p_return_time: input.is_working ? input.return_time ?? null : null,
        p_pickup_label: input.pickup_label ?? null,
        p_pickup_latitude: input.pickup_latitude ?? null,
        p_pickup_longitude: input.pickup_longitude ?? null,
      });
      if (error) throw error;
      const refreshed = await supabase.rpc('cleaner_city_refresh_open_drafts');
      if (refreshed.error && !/could not find the function|schema cache/i.test(refreshed.error.message || '')) {
        throw refreshed.error;
      }
      return data as CommuteTemplate;
    },
    onSuccess: () => {
      invalidateSchedule(queryClient, user?.id);
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useSetCommuteOverride() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      override_date: string;
      is_working: boolean;
      depart_time?: string | null;
      return_time?: string | null;
      override_kind?: string;
      note?: string | null;
      pickup_label?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_commute_override', {
        p_override_date: input.override_date,
        p_is_working: input.is_working,
        p_depart_time: input.is_working ? input.depart_time ?? null : null,
        p_return_time: input.is_working ? input.return_time ?? null : null,
        p_override_kind: input.override_kind ?? 'custom',
        p_note: input.note ?? null,
        p_pickup_label: input.pickup_label ?? null,
      });
      if (error) throw error;
      const refreshed = await supabase.rpc('cleaner_city_refresh_open_drafts');
      if (refreshed.error && !/could not find the function|schema cache/i.test(refreshed.error.message || '')) {
        throw refreshed.error;
      }
      return data as CommuteOverride;
    },
    onSuccess: () => {
      invalidateSchedule(queryClient, user?.id);
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useClearCommuteOverride() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (overrideDate: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_clear_commute_override', {
        p_override_date: overrideDate,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => invalidateSchedule(queryClient, user?.id),
  });
}

export function usePauseCommute() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (paused: boolean) => {
      const { data, error } = await supabase.rpc('cleaner_city_pause_commute', {
        p_paused: paused,
      });
      if (error) throw error;
      return data as CommuteProfile;
    },
    onSuccess: () => invalidateSchedule(queryClient, user?.id),
  });
}

export type CleanerCityVehicle = {
  id: string;
  vehicle_type: 'car' | 'bike';
  make: string | null;
  model: string | null;
  color: string | null;
  registration_number: string | null;
  seat_capacity: number;
  is_active: boolean;
  notes: string | null;
  preferred_pickup_label: string | null;
  preferred_drop_label: string | null;
};

export type VehicleDocument = {
  id: string;
  vehicle_id: string;
  document_type: string;
  status: string;
  label: string | null;
  notes: string | null;
};

export type OfficeLocation = {
  id: string;
  label: string | null;
  address_text: string | null;
  latitude: number;
  longitude: number;
  is_primary: boolean;
};

export type CommutePublication = {
  id: string;
  travel_date: string;
  direction: string;
  trip_kind?: 'commute' | 'extra' | string | null;
  depart_time: string;
  seats_available: number;
  seats_total: number;
  status: string;
  vehicle_id: string | null;
  route_polyline: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
  drop_order_json?: unknown;
};

function invalidateVehicles(queryClient: ReturnType<typeof useQueryClient>, userId?: string) {
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-vehicles', userId] });
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-vehicle-docs'] });
  queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', userId] });
}

export function useCleanerCityVehicles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-vehicles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(
          'id, vehicle_type, make, model, color, registration_number, seat_capacity, is_active, notes, preferred_pickup_label, preferred_drop_label',
        )
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CleanerCityVehicle[];
    },
  });
}

export function useVehicleDocuments(vehicleId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-vehicle-docs', user?.id, vehicleId],
    enabled: !!user?.id && !!vehicleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_documents')
        .select('id, vehicle_id, document_type, status, label, notes')
        .eq('user_id', user!.id)
        .eq('vehicle_id', vehicleId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as VehicleDocument[];
    },
  });
}

export function useUpsertVehicle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      vehicle_id?: string | null;
      vehicle_type: string;
      make?: string | null;
      model?: string | null;
      color?: string | null;
      registration_number: string;
      seat_capacity: number;
      is_active?: boolean;
      notes?: string | null;
      preferred_pickup_label?: string | null;
      preferred_drop_label?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_vehicle', {
        p_vehicle_id: input.vehicle_id ?? null,
        p_vehicle_type: input.vehicle_type,
        p_make: input.make ?? null,
        p_model: input.model ?? null,
        p_color: input.color ?? null,
        p_registration_number: input.registration_number,
        p_seat_capacity: input.seat_capacity,
        p_is_active: input.is_active ?? true,
        p_notes: input.notes ?? null,
        p_preferred_pickup_label: input.preferred_pickup_label ?? null,
        p_preferred_drop_label: input.preferred_drop_label ?? null,
      });
      if (error) throw error;
      return data as CleanerCityVehicle;
    },
    onSuccess: () => invalidateVehicles(queryClient, user?.id),
  });
}

export function useDeactivateVehicle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (vehicleId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_deactivate_vehicle', {
        p_vehicle_id: vehicleId,
      });
      if (error) throw error;
      return data as CleanerCityVehicle;
    },
    onSuccess: () => invalidateVehicles(queryClient, user?.id),
  });
}

export function useUpsertVehicleDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      vehicle_id: string;
      document_type: string;
      label?: string | null;
      notes?: string | null;
      storage_path?: string | null;
      document_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_vehicle_document', {
        p_vehicle_id: input.vehicle_id,
        p_document_type: input.document_type,
        p_label: input.label ?? null,
        p_storage_path: input.storage_path ?? null,
        p_notes: input.notes ?? null,
        p_document_id: input.document_id ?? null,
      });
      if (error) throw error;
      return data as VehicleDocument;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['cleaner-city-vehicle-docs', user?.id, vars.vehicle_id],
      });
    },
  });
}

export function useMyPublications(fromDate?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-publications', user?.id, fromDate],
    enabled: !!user?.id,
    queryFn: async () => {
      let q = supabase
        .from('commute_publications')
        .select(
          'id, travel_date, direction, trip_kind, depart_time, seats_available, seats_total, status, vehicle_id, route_polyline, origin_label, destination_label, drop_order_json',
        )
        .eq('host_user_id', user!.id)
        .order('travel_date', { ascending: true });
      if (fromDate) q = q.gte('travel_date', fromDate);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as CommutePublication[];
    },
  });
}

export function usePublishCommute() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      vehicle_id: string;
      travel_date: string;
      direction?: string;
      depart_time?: string | null;
      seats_available?: number | null;
      route_polyline?: string | null;
      publication_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_publish_commute', {
        p_vehicle_id: input.vehicle_id,
        p_travel_date: input.travel_date,
        p_direction: input.direction ?? 'to_office',
        p_depart_time: input.depart_time ?? null,
        p_seats_available: input.seats_available ?? null,
        p_route_polyline: input.route_polyline ?? null,
        p_publication_id: input.publication_id ?? null,
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: () => invalidateVehicles(queryClient, user?.id),
  });
}

/** Publish a non-commute Extra trip (elsewhere), blocked if commute seat overlaps. */
export function usePublishExtraTrip() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      vehicle_id: string;
      travel_date: string;
      depart_time: string;
      seats_available: number;
      route_polyline: string;
      origin_lat: number;
      origin_lng: number;
      dest_lat: number;
      dest_lng: number;
      origin_label?: string | null;
      dest_label?: string | null;
      route_distance_meters?: number | null;
      route_duration_seconds?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_publish_extra_trip', {
        p_vehicle_id: input.vehicle_id,
        p_travel_date: input.travel_date,
        p_depart_time: input.depart_time,
        p_seats_available: input.seats_available,
        p_route_polyline: input.route_polyline,
        p_origin_lat: input.origin_lat,
        p_origin_lng: input.origin_lng,
        p_dest_lat: input.dest_lat,
        p_dest_lng: input.dest_lng,
        p_origin_label: input.origin_label ?? 'Pickup',
        p_dest_label: input.dest_label ?? 'Destination',
        p_route_distance_meters: input.route_distance_meters ?? null,
        p_route_duration_seconds: input.route_duration_seconds ?? null,
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
      invalidateVehicles(queryClient, user?.id);
    },
  });
}

export function useCancelPublication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (publicationId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_cancel_publication', {
        p_publication_id: publicationId,
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
    },
  });
}

const OPEN_PUB_STATUSES = new Set(['draft', 'published', 'full']);

/**
 * Going-driven seats: ensure a live publication for host/date/direction.
 * Idempotent when published/full already exists. Uses vehicle capacity + preferred road.
 */
export function useEnsureHostPublication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      travel_date: string;
      direction: 'to_office' | 'to_home';
      depart_time?: string | null;
      vehicle_id?: string | null;
      route_polyline?: string | null;
      seats_available?: number | null;
      /** Existing open pubs for this host (optional; skips a refetch when provided). */
      existing?: CommutePublication[] | null;
    }) => {
      if (!user?.id) throw new Error('Sign in required');

      let existing = input.existing || null;
      if (!existing) {
        const { data, error } = await supabase
          .from('commute_publications')
          .select(
            'id, travel_date, direction, depart_time, seats_available, seats_total, status, vehicle_id, route_polyline, origin_label, destination_label, drop_order_json',
          )
          .eq('host_user_id', user.id)
          .eq('travel_date', input.travel_date)
          .eq('direction', input.direction);
        if (error) throw error;
        existing = (data || []) as CommutePublication[];
      }

      const open = existing.find(
        (p) =>
          p.travel_date === input.travel_date &&
          p.direction === input.direction &&
          OPEN_PUB_STATUSES.has(p.status),
      );
      if (open?.status === 'published' || open?.status === 'full') {
        return { publication: open, created: false as const };
      }

      let vehicleId = input.vehicle_id || open?.vehicle_id || null;
      let seats = input.seats_available ?? null;
      if (!vehicleId || seats == null) {
        const { data: vehicles, error: vErr } = await supabase
          .from('vehicles')
          .select('id, seat_capacity, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (vErr) throw vErr;
        const vehicle = vehicles?.[0];
        if (!vehicle?.id) throw new Error('Add an active vehicle before opening seats');
        vehicleId = vehicleId || vehicle.id;
        if (seats == null) seats = Number(vehicle.seat_capacity) || 1;
      }

      let polyline = input.route_polyline || open?.route_polyline || null;
      if (!polyline || String(polyline).trim().length < 10) {
        const { data: profile, error: pErr } = await supabase
          .from('commute_profiles')
          .select(
            'preferred_route_polyline, preferred_return_route_polyline',
          )
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle();
        if (pErr) throw pErr;
        polyline =
          input.direction === 'to_home'
            ? profile?.preferred_return_route_polyline || null
            : profile?.preferred_route_polyline || null;
      }
      if (!polyline || String(polyline).trim().length < 10) {
        throw new Error('Set your usual road on Route before seats can open for guests');
      }

      const { data, error } = await supabase.rpc('cleaner_city_publish_commute', {
        p_vehicle_id: vehicleId,
        p_travel_date: input.travel_date,
        p_direction: input.direction,
        p_depart_time: input.depart_time ?? null,
        p_seats_available: seats,
        p_route_polyline: polyline,
        p_publication_id: open?.status === 'draft' ? open.id : null,
      });
      if (error) throw error;
      return { publication: data as CommutePublication, created: true as const };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
    },
  });
}

/**
 * Going-driven seats: cancel open publications for one or both legs on a date.
 */
export function useCancelHostPublicationsForDate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      travel_date: string;
      directions: Array<'to_office' | 'to_home'>;
      existing?: CommutePublication[] | null;
    }) => {
      if (!user?.id) throw new Error('Sign in required');
      let existing = input.existing || null;
      if (!existing) {
        const { data, error } = await supabase
          .from('commute_publications')
          .select(
            'id, travel_date, direction, depart_time, seats_available, seats_total, status, vehicle_id, route_polyline, origin_label, destination_label, drop_order_json',
          )
          .eq('host_user_id', user.id)
          .eq('travel_date', input.travel_date);
        if (error) throw error;
        existing = (data || []) as CommutePublication[];
      }

      const cancelled: CommutePublication[] = [];
      for (const dir of input.directions) {
        const open = existing.filter(
          (p) =>
            p.direction === dir &&
            (p.trip_kind || 'commute') === 'commute' &&
            (p.status === 'draft' || p.status === 'published' || p.status === 'full'),
        );
        for (const pub of open) {
          const { data, error } = await supabase.rpc('cleaner_city_cancel_publication', {
            p_publication_id: pub.id,
          });
          if (error) throw error;
          cancelled.push(data as CommutePublication);
        }
      }
      return cancelled;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
    },
  });
}

export function useOfficeLocations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-offices', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('office_locations')
        .select('id, label, address_text, latitude, longitude, is_primary')
        .eq('user_id', user!.id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data || []) as OfficeLocation[];
    },
  });
}

export function useUpsertOfficeLocation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      latitude: number;
      longitude: number;
      label?: string | null;
      address_text?: string | null;
      is_primary?: boolean;
      office_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_office_location', {
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_label: input.label ?? null,
        p_address_text: input.address_text ?? null,
        p_is_primary: input.is_primary ?? true,
        p_office_id: input.office_id ?? null,
      });
      if (error) throw error;
      return data as OfficeLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-offices', user?.id] });
    },
  });
}

export function useStoreRouteGeometry() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      publication_id: string;
      route_polyline: string;
      origin_latitude?: number | null;
      origin_longitude?: number | null;
      destination_latitude?: number | null;
      destination_longitude?: number | null;
      origin_label?: string | null;
      destination_label?: string | null;
      route_distance_meters?: number | null;
      route_duration_seconds?: number | null;
      route_provider?: string;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_store_route_geometry', {
        p_publication_id: input.publication_id,
        p_route_polyline: input.route_polyline,
        p_origin_latitude: input.origin_latitude ?? null,
        p_origin_longitude: input.origin_longitude ?? null,
        p_destination_latitude: input.destination_latitude ?? null,
        p_destination_longitude: input.destination_longitude ?? null,
        p_origin_label: input.origin_label ?? null,
        p_destination_label: input.destination_label ?? null,
        p_route_distance_meters: input.route_distance_meters ?? null,
        p_route_duration_seconds: input.route_duration_seconds ?? null,
        p_route_provider: input.route_provider ?? 'google',
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
    },
  });
}

export type MatchResult = {
  publication_id: string;
  host_user_id: string;
  travel_date: string;
  direction: string;
  depart_time: string;
  seats_available: number;
  seats_total: number;
  vehicle_type: string;
  vehicle_color: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_registration?: string | null;
  host_company: string | null;
  host_name?: string | null;
  host_avatar_url?: string | null;
  host_flat?: string | null;
  host_society?: string | null;
  origin_label: string;
  destination_label: string;
  has_route: boolean;
  estimated_detour_minutes: number | null;
  score: number;
  reasons: string[];
  host_avg_stars?: number | null;
  host_rating_count?: number | null;
  estimated_fuel_paise?: number | null;
  shared_circle?: boolean;
  trip_kind?: 'commute' | 'extra' | string | null;
  reason_labels?: string[];
  pickup_deviation_meters?: number | null;
  destination_deviation_meters?: number | null;
  pickup_walk_meters?: number | null;
  pickup_route_index?: number | null;
  drop_route_index?: number | null;
  on_route_drop?: boolean;
  host_no_show_count?: number | null;
  host_completed_rides?: number | null;
  host_vehicle_verified?: boolean;
  extra_stop_meters?: number | null;
  road_overlap_pct?: number | null;
  route_distance_meters?: number | null;
};

export type MatchResponse = {
  date: string;
  direction: string;
  matches: MatchResult[];
  thresholds?: Record<string, number>;
};

export type CleanerCityRide = {
  id: string;
  publication_id: string | null;
  host_user_id: string;
  guest_user_id: string;
  travel_date: string;
  status: string;
  guest_pickup_latitude?: number | null;
  guest_pickup_longitude?: number | null;
  guest_dest_latitude?: number | null;
  guest_dest_longitude?: number | null;
  meeting_point_label?: string | null;
  meeting_point_latitude?: number | null;
  meeting_point_longitude?: number | null;
  estimated_fuel_paise?: number | null;
  fuel_snapshot?: Record<string, unknown> | null;
  fuel_petrol_paise_per_litre?: number | null;
  fuel_mileage_km_per_litre?: number | null;
  fuel_distance_meters?: number | null;
  fuel_total_paise?: number | null;
  fuel_host_share_paise?: number | null;
  fuel_calc_version?: number | null;
  request_expires_at?: string | null;
  pickup_deadline_at?: string | null;
  society_id?: string;
};

function normalizeRideRow(data: unknown): CleanerCityRide | null {
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const id = (row as { id?: string }).id;
  if (!id) return null;
  return row as CleanerCityRide;
}

export type CommuteWaitlistEntry = {
  id: string;
  user_id: string;
  society_id: string;
  travel_date: string;
  direction: string;
  depart_time: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dest_latitude: number | null;
  dest_longitude: number | null;
  status: string;
  matched_publication_id: string | null;
};

export type SocietyMeetupPoint = {
  id: string;
  society_id: string;
  label: string;
  latitude: number;
  longitude: number;
  kind: string;
  is_active: boolean;
  sort_order: number;
};

export type CommuteEmergencyContact = {
  id: string;
  user_id: string;
  society_id: string;
  contact_name: string;
  phone: string | null;
  notify_user_id: string | null;
  is_primary: boolean;
  verified_at?: string | null;
  verification_method?: string | null;
};

export type RideQuickMessage = {
  id: string;
  ride_id: string;
  society_id: string;
  sender_user_id: string;
  phrase_key: string;
  created_at: string;
};

export type CommuteCircle = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string | null;
  invite_expires_at?: string | null;
  invite_expired?: boolean | null;
  role: string;
  member_count: number;
};

export type CommuteBlockRow = {
  blocked_user_id: string;
  reason: string | null;
  created_at: string;
};

export function useFindMatches() {
  return useMutation({
    mutationFn: async (input: {
      date: string;
      direction?: string;
      depart_time?: string | null;
      guest_pickup_lat?: number | null;
      guest_pickup_lng?: number | null;
      guest_dest_lat?: number | null;
      guest_dest_lng?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_find_matches', {
        p_date: input.date,
        p_direction: input.direction ?? 'to_office',
        p_depart_time: input.depart_time ?? null,
        p_guest_pickup_lat: input.guest_pickup_lat ?? null,
        p_guest_pickup_lng: input.guest_pickup_lng ?? null,
        p_guest_dest_lat: input.guest_dest_lat ?? null,
        p_guest_dest_lng: input.guest_dest_lng ?? null,
      });
      if (error) throw error;
      const base = data as MatchResponse;
      const matches = Array.isArray(base?.matches) ? base.matches : [];
      if (matches.length === 0) return base;

      const ids = matches.map((m) => m.publication_id).filter(Boolean);
      const { data: cards, error: cardError } = await supabase.rpc(
        'cleaner_city_publication_vehicle_cards',
        { p_publication_ids: ids },
      );
      if (cardError || !Array.isArray(cards)) return base;

      const byPub = new Map<string, Record<string, unknown>>();
      for (const row of cards as Array<Record<string, unknown>>) {
        if (row?.publication_id) byPub.set(String(row.publication_id), row);
      }

      return {
        ...base,
        matches: matches.map((m) => {
          const extra = byPub.get(m.publication_id);
          if (!extra) return m;
          return {
            ...m,
            vehicle_type: (extra.vehicle_type as string) || m.vehicle_type,
            vehicle_color: (extra.vehicle_color as string | null) ?? m.vehicle_color,
            vehicle_make: (extra.vehicle_make as string | null) ?? null,
            vehicle_model: (extra.vehicle_model as string | null) ?? null,
            vehicle_registration: (extra.vehicle_registration as string | null) ?? null,
            route_distance_meters:
              (extra.route_distance_meters as number | null | undefined) ??
              m.route_distance_meters ??
              null,
            origin_label: (extra.origin_label as string) || m.origin_label,
            destination_label: (extra.destination_label as string) || m.destination_label,
          };
        }),
      };
    },
  });
}

export type CleanerCityRideCard = CleanerCityRide & {
  guest_name?: string | null;
  guest_flat?: string | null;
  guest_society?: string | null;
  guest_avatar_url?: string | null;
  guest_company?: string | null;
  host_name?: string | null;
  host_flat?: string | null;
  host_avatar_url?: string | null;
  host_company?: string | null;
  direction?: string | null;
  depart_time?: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
  drop_order_json?: unknown;
};

export function useMyRides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-rides', user?.id],
    enabled: !!user?.id,
    refetchInterval: 12_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rides')
        .select(
          'id, publication_id, society_id, host_user_id, guest_user_id, travel_date, status, guest_pickup_latitude, guest_pickup_longitude, guest_dest_latitude, guest_dest_longitude, meeting_point_label, meeting_point_latitude, meeting_point_longitude, estimated_fuel_paise, fuel_snapshot, fuel_petrol_paise_per_litre, fuel_mileage_km_per_litre, fuel_distance_meters, fuel_total_paise, fuel_host_share_paise, fuel_calc_version, request_expires_at, pickup_deadline_at',
        )
        .or(`host_user_id.eq.${user!.id},guest_user_id.eq.${user!.id}`)
        .order('travel_date', { ascending: false })
        .limit(40);
      if (error) throw error;
      const rides = (data || []) as CleanerCityRide[];
      const people = [
        ...new Set(
          rides.flatMap((r) => [r.host_user_id, r.guest_user_id].filter(Boolean) as string[]),
        ),
      ];
      const pubIds = [
        ...new Set(rides.map((r) => r.publication_id).filter(Boolean) as string[]),
      ];
      let byId: Record<
        string,
        {
          name?: string | null;
          flat_number?: string | null;
          avatar_url?: string | null;
          society_id?: string | null;
        }
      > = {};
      let companyById: Record<string, string | null> = {};
      let societyById: Record<string, string | null> = {};
      let pubById: Record<
        string,
        {
          direction?: string | null;
          depart_time?: string | null;
          origin_label?: string | null;
          destination_label?: string | null;
          drop_order_json?: unknown;
        }
      > = {};
      if (people.length || pubIds.length) {
        const [{ data: profiles }, { data: commute }, { data: pubs }] = await Promise.all([
          people.length
            ? supabase
                .from('profiles')
                .select('id, name, flat_number, avatar_url, society_id')
                .in('id', people)
            : Promise.resolve({ data: [] as any[] }),
          people.length
            ? supabase
                .from('commute_profiles')
                .select('user_id, company_name')
                .in('user_id', people)
                .is('deleted_at', null)
            : Promise.resolve({ data: [] as any[] }),
          pubIds.length
            ? supabase
                .from('commute_publications')
                .select(
                  'id, direction, depart_time, origin_label, destination_label, drop_order_json',
                )
                .in('id', pubIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        for (const p of profiles || []) {
          byId[p.id] = {
            name: p.name,
            flat_number: p.flat_number,
            avatar_url: p.avatar_url,
            society_id: p.society_id,
          };
        }
        for (const c of commute || []) {
          companyById[c.user_id] = c.company_name;
        }
        for (const p of pubs || []) {
          pubById[p.id] = {
            direction: p.direction,
            depart_time: p.depart_time,
            origin_label: p.origin_label,
            destination_label: p.destination_label,
            drop_order_json: p.drop_order_json,
          };
        }
        const societyIds = [
          ...new Set(
            Object.values(byId)
              .map((p) => p.society_id)
              .filter(Boolean) as string[],
          ),
        ];
        if (societyIds.length) {
          const { data: societies } = await supabase
            .from('societies')
            .select('id, name')
            .in('id', societyIds);
          for (const s of societies || []) {
            societyById[s.id] = s.name || null;
          }
        }
      }
      return rides.map((r) => {
        const pub = r.publication_id ? pubById[r.publication_id] : null;
        const guestSocietyId = byId[r.guest_user_id]?.society_id || null;
        return {
          ...r,
          guest_name: byId[r.guest_user_id]?.name || null,
          guest_flat: byId[r.guest_user_id]?.flat_number || null,
          guest_society: guestSocietyId ? societyById[guestSocietyId] || null : null,
          guest_avatar_url: byId[r.guest_user_id]?.avatar_url || null,
          guest_company: companyById[r.guest_user_id] || null,
          host_name: byId[r.host_user_id]?.name || null,
          host_flat: byId[r.host_user_id]?.flat_number || null,
          host_avatar_url: byId[r.host_user_id]?.avatar_url || null,
          host_company: companyById[r.host_user_id] || null,
          direction: pub?.direction || null,
          depart_time: pub?.depart_time || null,
          origin_label: pub?.origin_label || null,
          destination_label: pub?.destination_label || null,
          drop_order_json: pub?.drop_order_json,
        };
      }) as CleanerCityRideCard[];
    },
  });
}

/** Active rides on one publication - for multi-guest drop order (not capped by host ride list). */
export type PublicationRideGuest = CleanerCityRide & {
  guest_name?: string | null;
  guest_flat?: string | null;
};

export function usePublicationRides(publicationId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-publication-rides', publicationId, user?.id],
    enabled: !!user?.id && !!publicationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rides')
        .select(
          'id, publication_id, society_id, host_user_id, guest_user_id, travel_date, status, guest_pickup_latitude, guest_pickup_longitude, guest_dest_latitude, guest_dest_longitude, meeting_point_label, meeting_point_latitude, meeting_point_longitude, estimated_fuel_paise, fuel_snapshot, fuel_petrol_paise_per_litre, fuel_mileage_km_per_litre, fuel_distance_meters, fuel_total_paise, fuel_host_share_paise, fuel_calc_version, request_expires_at, pickup_deadline_at',
        )
        .eq('publication_id', publicationId!)
        .in('status', ['confirmed', 'pickup_pending', 'started'])
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rides = (data || []) as CleanerCityRide[];
      const guestIds = [...new Set(rides.map((r) => r.guest_user_id).filter(Boolean))];
      let nameById: Record<string, { name?: string | null; flat_number?: string | null }> = {};
      if (guestIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, flat_number')
          .in('id', guestIds);
        for (const p of profiles || []) {
          nameById[p.id] = { name: p.name, flat_number: p.flat_number };
        }
      }
      return rides.map((r) => ({
        ...r,
        guest_name: nameById[r.guest_user_id]?.name || null,
        guest_flat: nameById[r.guest_user_id]?.flat_number || null,
      })) as PublicationRideGuest[];
    },
  });
}

export async function fetchMyActiveGuestRide(input?: {
  travel_date?: string | null;
  direction?: string | null;
}): Promise<CleanerCityRideCard | null> {
  const { data, error } = await supabase.rpc('cleaner_city_my_active_guest_ride', {
    p_travel_date: input?.travel_date ?? null,
    p_direction: input?.direction ?? null,
  });
  if (error) throw error;
  const ride = normalizeRideRow(data);
  if (!ride?.id) return null;

  let host_name: string | null = null;
  let host_flat: string | null = null;
  let host_avatar_url: string | null = null;
  let host_company: string | null = null;
  let direction: string | null = null;
  let depart_time: string | null = null;
  let origin_label: string | null = null;
  let destination_label: string | null = null;
  let drop_order_json: unknown = null;

  const tasks: Promise<void>[] = [];
  if (ride.host_user_id) {
    tasks.push(
      (async () => {
        const [{ data: profile }, { data: commute }] = await Promise.all([
          supabase
            .from('profiles')
            .select('name, flat_number, avatar_url')
            .eq('id', ride.host_user_id)
            .maybeSingle(),
          supabase
            .from('commute_profiles')
            .select('company_name')
            .eq('user_id', ride.host_user_id)
            .is('deleted_at', null)
            .maybeSingle(),
        ]);
        host_name = profile?.name || null;
        host_flat = profile?.flat_number || null;
        host_avatar_url = profile?.avatar_url || null;
        host_company = commute?.company_name || null;
      })(),
    );
  }
  if (ride.publication_id) {
    tasks.push(
      (async () => {
        const { data: pub } = await supabase
          .from('commute_publications')
          .select(
            'direction, depart_time, origin_label, destination_label, drop_order_json',
          )
          .eq('id', ride.publication_id!)
          .maybeSingle();
        direction = pub?.direction || null;
        depart_time = pub?.depart_time || null;
        origin_label = pub?.origin_label || null;
        destination_label = pub?.destination_label || null;
        drop_order_json = pub?.drop_order_json ?? null;
      })(),
    );
  }
  await Promise.all(tasks);

  return {
    ...ride,
    host_name,
    host_flat,
    host_avatar_url,
    host_company,
    direction,
    depart_time,
    origin_label,
    destination_label,
    drop_order_json,
  };
}

export function useMyActiveGuestRide() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-active-guest-ride', user?.id],
    enabled: !!user?.id,
    refetchInterval: 12_000,
    queryFn: () => fetchMyActiveGuestRide(),
  });
}

export function useRequestRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    meta: { suppressGlobalErrorToast: true },
    mutationFn: async (input: {
      publication_id: string;
      note?: string | null;
      guest_pickup_lat?: number | null;
      guest_pickup_lng?: number | null;
      guest_dest_lat?: number | null;
      guest_dest_lng?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_request_ride', {
        p_publication_id: input.publication_id,
        p_note: input.note ?? null,
        p_guest_pickup_lat: input.guest_pickup_lat ?? null,
        p_guest_pickup_lng: input.guest_pickup_lng ?? null,
        p_guest_dest_lat: input.guest_dest_lat ?? null,
        p_guest_dest_lng: input.guest_dest_lng ?? null,
      });
      if (error) {
        const err = new Error(error.message || 'Could not request ride');
        (err as Error & { code?: string; details?: string }).code = error.code;
        (err as Error & { details?: string }).details = error.details || undefined;
        throw err;
      }
      const ride = normalizeRideRow(data);
      if (!ride?.id) throw new Error('Request created but ride id was missing - pull to refresh');
      return ride;
    },
    onSuccess: (ride) => {
      if (ride?.id) {
        queryClient.setQueryData(['cleaner-city-ride', ride.id, user?.id], ride);
      }
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useRespondRideRequest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc('cleaner_city_respond_ride_request', {
        p_ride_id: input.ride_id,
        p_accept: input.accept,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-chat-inbox'] });
      const pubId = (data as CleanerCityRide | null)?.publication_id;
      if (pubId) {
        queryClient.invalidateQueries({
          queryKey: ['cleaner-city-publication-rides', pubId],
        });
      }
    },
  });
}

export function useCancelRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; reason?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_cancel_ride', {
        p_ride_id: input.ride_id,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-chat-inbox'] });
      const pubId = (data as CleanerCityRide | null)?.publication_id;
      if (pubId) {
        queryClient.invalidateQueries({
          queryKey: ['cleaner-city-publication-rides', pubId],
        });
      }
    },
  });
}

export function useGenerateRideOtp() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_generate_ride_otp', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return data as { ride_id: string; otp: string; expires_at: string; status: string };
    },
    onSuccess: (_data, rideId) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', rideId] });
    },
  });
}

export function useStartRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; otp: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_start_ride', {
        p_ride_id: input.ride_id,
        p_otp: input.otp,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
    },
  });
}

export function useCompleteRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_complete_ride', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (_data, rideId) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', rideId] });
    },
  });
}

export type RideMission = CleanerCityRide & {
  partner_user_id?: string | null;
  partner_name?: string | null;
  partner_avatar_url?: string | null;
  partner_flat?: string | null;
  partner_society?: string | null;
  partner_society_id?: string | null;
  partner_company?: string | null;
  direction?: string | null;
  depart_time?: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  route_polyline?: string | null;
  drop_order_json?: unknown;
};

async function enrichRideMission(
  ride: CleanerCityRide,
  viewerId: string,
): Promise<RideMission> {
  const partnerId =
    ride.host_user_id === viewerId ? ride.guest_user_id : ride.host_user_id;
  let partner_name: string | null = null;
  let partner_avatar_url: string | null = null;
  let partner_flat: string | null = null;
  let partner_society: string | null = null;
  let partner_society_id: string | null = null;
  let partner_company: string | null = null;
  let direction: string | null = null;
  let depart_time: string | null = null;
  let origin_label: string | null = null;
  let destination_label: string | null = null;
  let origin_latitude: number | null = null;
  let origin_longitude: number | null = null;
  let route_polyline: string | null = null;
  let drop_order_json: unknown = null;

  const tasks: Promise<void>[] = [];
  if (partnerId) {
    tasks.push(
      (async () => {
        const [{ data: profile }, { data: commute }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, name, flat_number, avatar_url, society_id')
            .eq('id', partnerId)
            .maybeSingle(),
          supabase
            .from('commute_profiles')
            .select('company_name')
            .eq('user_id', partnerId)
            .is('deleted_at', null)
            .maybeSingle(),
        ]);
        partner_name = profile?.name || null;
        partner_avatar_url = profile?.avatar_url || null;
        partner_flat = profile?.flat_number || null;
        partner_company = commute?.company_name || null;
        partner_society_id = profile?.society_id || null;
        if (profile?.society_id) {
          const { data: society } = await supabase
            .from('societies')
            .select('name')
            .eq('id', profile.society_id)
            .maybeSingle();
          partner_society = society?.name || null;
        }
      })(),
    );
  }
  if (ride.publication_id) {
    tasks.push(
      (async () => {
        const { data: pub } = await supabase
          .from('commute_publications')
          .select(
            'direction, depart_time, origin_label, destination_label, origin_latitude, origin_longitude, route_polyline, drop_order_json',
          )
          .eq('id', ride.publication_id!)
          .maybeSingle();
        direction = pub?.direction || null;
        depart_time = pub?.depart_time || null;
        origin_label = pub?.origin_label || null;
        destination_label = pub?.destination_label || null;
        origin_latitude =
          pub?.origin_latitude != null ? Number(pub.origin_latitude) : null;
        origin_longitude =
          pub?.origin_longitude != null ? Number(pub.origin_longitude) : null;
        route_polyline = pub?.route_polyline || null;
        drop_order_json = pub?.drop_order_json ?? null;
      })(),
    );
  }
  await Promise.all(tasks);

  return {
    ...ride,
    partner_user_id: partnerId,
    partner_name,
    partner_avatar_url,
    partner_flat,
    partner_society,
    partner_society_id,
    partner_company,
    direction,
    depart_time,
    origin_label,
    destination_label,
    origin_latitude,
    origin_longitude,
    route_polyline,
    drop_order_json,
  };
}

export function useCleanerCityRide(rideId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-ride', rideId, user?.id],
    enabled: !!user?.id && !!rideId,
    retry: 2,
    refetchInterval: (q) => {
      const status = (q.state.data as RideMission | undefined)?.status;
      if (status && ['requested', 'confirmed', 'pickup_pending', 'started'].includes(status)) {
        return 10_000;
      }
      return false;
    },
    queryFn: async () => {
      let base: CleanerCityRide | null = null;
      const { data: rpcData, error: rpcError } = await supabase.rpc('cleaner_city_get_ride', {
        p_ride_id: rideId,
      });
      if (!rpcError) {
        base = normalizeRideRow(rpcData);
      }
      if (!base) {
        const { data, error } = await supabase
          .from('rides')
          .select(
            'id, publication_id, society_id, host_user_id, guest_user_id, travel_date, status, guest_pickup_latitude, guest_pickup_longitude, guest_dest_latitude, guest_dest_longitude, meeting_point_label, meeting_point_latitude, meeting_point_longitude, estimated_fuel_paise, fuel_snapshot, fuel_petrol_paise_per_litre, fuel_mileage_km_per_litre, fuel_distance_meters, fuel_total_paise, fuel_host_share_paise, fuel_calc_version, request_expires_at, pickup_deadline_at',
          )
          .eq('id', rideId!)
          .maybeSingle();
        if (error) throw error;
        base = (data as CleanerCityRide | null) || null;
      }
      if (!base) return null;
      return enrichRideMission(base, user!.id);
    },
  });
}

/** Alias used by Mission UI - same enriched ride query. */
export function useRideMission(rideId?: string | null) {
  return useCleanerCityRide(rideId);
}

export function useRideLocations(rideId?: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-ride-locations', rideId],
    enabled: !!rideId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_latest_ride_locations', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return (data || []) as Array<{
        user_id: string;
        latitude: number;
        longitude: number;
        recorded_at: string;
        role: string;
      }>;
    },
  });
}

export function useUpsertRideLocation() {
  return useMutation({
    // Background pings must not spam "check your internet" toasts on every tick.
    meta: { suppressGlobalErrorToast: true },
    mutationFn: async (input: {
      ride_id: string;
      latitude: number;
      longitude: number;
      accuracy_meters?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_ride_location', {
        p_ride_id: input.ride_id,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_accuracy_meters: input.accuracy_meters ?? null,
        p_heading: null,
        p_speed_mps: null,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useReportIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ride_id: string;
      incident_type: string;
      note?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      severity?: string;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_report_incident', {
        p_ride_id: input.ride_id,
        p_incident_type: input.incident_type,
        p_note: input.note ?? null,
        p_latitude: input.latitude ?? null,
        p_longitude: input.longitude ?? null,
        p_severity: input.severity ?? 'high',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides'] });
    },
  });
}

export function useCreateShareToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_create_share_token', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return data as { token: string; expires_at: string };
    },
    onSuccess: (_d, rideId) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride-events', rideId] });
    },
  });
}

export function useRevokeShareToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_revoke_share_token', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: (_d, rideId) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride-events', rideId] });
    },
  });
}

export type RideLifecycleEvent = {
  id: string;
  event: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export function useRideLifecycleEvents(rideId?: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-ride-events', rideId],
    enabled: !!rideId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_list_ride_events', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as RideLifecycleEvent[];
    },
  });
}

export type CleanerCityCapabilities = {
  relay_call: boolean;
  sos_sms: boolean;
  fuel_checkout: boolean;
  ios_background_location: boolean;
  share_link_ttl_hours: number;
};

export function useCleanerCityCapabilities() {
  return useQuery({
    queryKey: ['cleaner-city-runtime-capabilities'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_runtime_capabilities');
      if (error) throw error;
      return data as CleanerCityCapabilities;
    },
  });
}

export function useSubmitRating() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; stars: number; comment?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_submit_rating', {
        p_ride_id: input.ride_id,
        p_stars: input.stars,
        p_comment: input.comment ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
    },
  });
}

export function useProposeCostShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ride_id: string; amount_paise: number; note?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_propose_cost_share', {
        p_ride_id: input.ride_id,
        p_amount_paise: input.amount_paise,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-cost-shares', vars.ride_id] });
    },
  });
}

export function useConfirmCostShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { cost_share_id: string; accept: boolean; ride_id: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_confirm_cost_share', {
        p_cost_share_id: input.cost_share_id,
        p_accept: input.accept,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-cost-shares', vars.ride_id] });
    },
  });
}

export function useRideCostShares(rideId?: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-cost-shares', rideId],
    enabled: !!rideId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_cost_shares')
        .select('id, ride_id, proposer_user_id, amount_paise, currency, status, note, created_at')
        .eq('ride_id', rideId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useBlockUser() {
  return useMutation({
    mutationFn: async (input: { blocked_user_id: string; reason?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_block_user', {
        p_blocked_user_id: input.blocked_user_id,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useReputation(userId?: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-reputation', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_reputation', {
        p_user_id: userId,
      });
      if (error) throw error;
      return data as {
        user_id: string;
        avg_stars: number | null;
        rating_count: number;
        completed_rides: number;
        incident_mentions: number;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 1-4: autopilot, waitlist, no-show, meeting points, emergency contacts,
// quick messages, circles, blocks management.
// ---------------------------------------------------------------------------

export function useSetAutopilot() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { enabled: boolean; confirm_mode?: 'confirm' | 'auto' }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_autopilot', {
        p_enabled: input.enabled,
        p_confirm_mode: input.confirm_mode ?? 'auto',
      });
      if (error) throw error;
      return data as CommuteProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', user?.id] });
    },
  });
}

/** One-shot: turn Auto-offer on in auto mode when host setup is ready. */
export function useMaybeEnableDefaultAutopilot() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        'cleaner_city_maybe_enable_default_autopilot',
      );
      if (error) {
        // Older backends without the RPC: soft-fail so setup still works.
        if (/could not find the function|schema cache|PGRST202/i.test(error.message || '')) {
          return null;
        }
        throw error;
      }
      return data as CommuteProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', user?.id] });
    },
  });
}

export function useConfirmPublication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { publication_id: string; confirm?: boolean }) => {
      const { data, error } = await supabase.rpc('cleaner_city_confirm_publication', {
        p_publication_id: input.publication_id,
        p_confirm: input.confirm ?? true,
      });
      if (error) throw error;
      return data as CommutePublication;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications', user?.id] });
    },
  });
}

export function useJoinWaitlist() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      date: string;
      direction?: string;
      depart_time?: string | null;
      pickup_lat?: number | null;
      pickup_lng?: number | null;
      dest_lat?: number | null;
      dest_lng?: number | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_join_waitlist', {
        p_date: input.date,
        p_direction: input.direction ?? 'to_office',
        p_depart_time: input.depart_time ?? null,
        p_pickup_lat: input.pickup_lat ?? null,
        p_pickup_lng: input.pickup_lng ?? null,
        p_dest_lat: input.dest_lat ?? null,
        p_dest_lng: input.dest_lng ?? null,
      });
      if (error) throw error;
      return data as CommuteWaitlistEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-waitlist', user?.id] });
    },
  });
}

export function useLeaveWaitlist() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { date: string; direction?: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_leave_waitlist', {
        p_date: input.date,
        p_direction: input.direction ?? 'to_office',
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-waitlist', user?.id] });
    },
  });
}

export function useMyWaitlist() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-waitlist', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_waitlist')
        .select(
          'id, user_id, society_id, travel_date, direction, depart_time, pickup_latitude, pickup_longitude, dest_latitude, dest_longitude, status, matched_publication_id',
        )
        .eq('user_id', user!.id)
        .order('travel_date', { ascending: true });
      if (error) throw error;
      return (data || []) as CommuteWaitlistEntry[];
    },
  });
}

export function useMarkNoShow() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; note?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_mark_no_show', {
        p_ride_id: input.ride_id,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useSuggestReplacements() {
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_suggest_replacements', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return data as { ride_id: string; alternatives: MatchResult[] };
    },
  });
}

export function useMeetupPoints() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-meetup-points', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_list_meetup_points');
      if (error) throw error;
      return (data || []) as SocietyMeetupPoint[];
    },
  });
}

export function useSetMeetingPoint() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      ride_id: string;
      label: string;
      latitude: number;
      longitude: number;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_meeting_point', {
        p_ride_id: input.ride_id,
        p_label: input.label,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
    },
  });
}

export function useEmergencyContacts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-emergency-contacts', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_emergency_contacts')
        .select('id, user_id, society_id, contact_name, phone, notify_user_id, is_primary, verified_at, verification_method')
        .eq('user_id', user!.id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data || []) as CommuteEmergencyContact[];
    },
  });
}

export function useUpsertEmergencyContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      contact_name: string;
      phone?: string | null;
      notify_user_id?: string | null;
      is_primary?: boolean;
      contact_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_emergency_contact', {
        p_contact_name: input.contact_name,
        p_phone: input.phone ?? null,
        p_notify_user_id: input.notify_user_id ?? null,
        p_is_primary: input.is_primary ?? false,
        p_contact_id: input.contact_id ?? null,
      });
      if (error) throw error;
      return data as CommuteEmergencyContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-emergency-contacts', user?.id] });
    },
  });
}

export function useDeleteEmergencyContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_delete_emergency_contact', {
        p_contact_id: contactId,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-emergency-contacts', user?.id] });
    },
  });
}

export function useSendQuickMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ride_id: string; phrase_key: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_send_quick_message', {
        p_ride_id: input.ride_id,
        p_phrase_key: input.phrase_key,
      });
      if (error) throw error;
      return data as RideQuickMessage;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-quick-messages', vars.ride_id] });
    },
  });
}

export function useQuickMessages(rideId?: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-quick-messages', rideId],
    enabled: !!rideId,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_quick_messages')
        .select('id, ride_id, society_id, sender_user_id, phrase_key, created_at')
        .eq('ride_id', rideId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as RideQuickMessage[];
    },
  });
}

export function useMyCircles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-circles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_my_circles');
      if (error) throw error;
      return (data || []) as CommuteCircle[];
    },
  });
}

export function useCreateCircle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_create_circle', {
        p_name: input.name,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useJoinCircle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (inviteCode: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_join_circle', {
        p_invite_code: inviteCode,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useLeaveCircle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (circleId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_leave_circle', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useRemoveCircleMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { circle_id: string; member_user_id: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_remove_circle_member', {
        p_circle_id: input.circle_id,
        p_member_user_id: input.member_user_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useRotateCircleInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (circleId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_rotate_circle_invite', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useListBlocks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-blocks', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_list_blocks');
      if (error) throw error;
      return (data || []) as CommuteBlockRow[];
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (blockedUserId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_unblock_user', {
        p_blocked_user_id: blockedUserId,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-blocks', user?.id] });
    },
  });
}

export function useRepeatLastCommute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const call = () => supabase.rpc('cleaner_city_repeat_last_commute');
      let { data, error } = await call();
      if (error?.message?.includes('schema cache')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        ({ data, error } = await call());
      }
      if (error) throw error;
      return data as {
        action: string;
        publication_id?: string;
        ride_id?: string;
        travel_date?: string;
        direction?: string;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useMarkWfh() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (date: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_mark_wfh', { p_date: date });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-overrides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-effective'] });
    },
  });
}

export function useDisputeRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; note?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_dispute_ride', {
        p_ride_id: input.ride_id,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
    },
  });
}

export function useRequestMaskedCall() {
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_request_masked_call', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      const alertId = data?.alert_id;
      if (alertId) {
        const dispatched = await supabase.functions.invoke('cleaner-city-dispatch-alerts', {
          body: { alert_id: alertId },
        });
        if (dispatched.error) {
          return { ...data, dispatch_error: dispatched.error.message || 'Dispatch failed' };
        }
        return { ...data, dispatch: dispatched.data };
      }
      return data;
    },
  });
}

export function useDispatchSafetyAlerts() {
  return useMutation({
    mutationFn: async (alertId?: string | null) => {
      const { data, error } = await supabase.functions.invoke('cleaner-city-dispatch-alerts', {
        body: alertId ? { alert_id: alertId } : { retry: true },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useStartContactVerification() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_start_contact_verification', {
        p_contact_id: contactId,
      });
      if (error) throw error;
      if (data?.alert_id) {
        await supabase.functions.invoke('cleaner-city-dispatch-alerts', {
          body: { alert_id: data.alert_id },
        });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-emergency-contacts', user?.id] });
    },
  });
}

export function useConfirmContactVerification() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { contact_id: string; code: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_confirm_contact_verification', {
        p_contact_id: input.contact_id,
        p_code: input.code,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-emergency-contacts', user?.id] });
    },
  });
}

export function useSetCirclePrefs() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      circle_only: boolean;
      visibility: string;
      show_on_board: boolean;
      require_circle_history?: boolean;
      open_city?: boolean;
      prefer_circle?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_discovery_prefs', {
        p_circle_only: input.circle_only,
        p_visibility: input.visibility,
        p_show_on_board: input.show_on_board,
        p_require_circle_history: !!input.require_circle_history,
        p_open_city: !!input.open_city,
        p_prefer_circle: !!input.prefer_circle,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-profile', user?.id] });
    },
  });
}

export function useCircleInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-circle-invites', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_my_circle_invites');
      if (error) throw error;
      return (data || []) as Array<{ id: string; circle_id: string; circle_name: string; status: string; expires_at: string }>;
    },
  });
}

export function useInviteToCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { circle_id: string; invitee: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_invite_to_circle', {
        p_circle_id: input.circle_id,
        p_invitee: input.invitee,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circle-invites'] });
    },
  });
}

export function useRespondCircleInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { invite_id: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc('cleaner_city_respond_circle_invite', {
        p_invite_id: input.invite_id,
        p_accept: input.accept,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circle-invites', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circles', user?.id] });
    },
  });
}

export function useCircleMembers(circleId: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-circle-members', circleId],
    enabled: !!circleId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_list_circle_members', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return (data || []) as Array<{ user_id: string; role: string; display_name: string }>;
    },
  });
}

export function useCircleTomorrow(circleId: string | null) {
  return useQuery({
    queryKey: ['cleaner-city-circle-tomorrow', circleId],
    enabled: !!circleId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_circle_tomorrow_board', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return (data || []) as Array<{
        display_name: string;
        travel_date: string;
        direction: string;
        depart_time: string;
        seats_available: number;
        origin_label: string;
        destination_label: string;
      }>;
    },
  });
}

export function useCleanerCityBadges() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-badges', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaner_city_badges')
        .select('badge_key, earned_at')
        .eq('user_id', user.id);
      if (error) throw error;
      return data || [];
    },
  });
}

export type RideChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
};

export function useRideChat(rideId?: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['cleaner-city-ride-chat', rideId],
    enabled: !!rideId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_chat_messages')
        .select('id, sender_id, body, created_at')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      const rows = (data || []) as RideChatMessage[];
      const senderIds = [...new Set(rows.map((r) => r.sender_id).filter(Boolean))];
      let nameById: Record<string, { name?: string | null; avatar_url?: string | null }> = {};
      if (senderIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', senderIds);
        for (const p of profiles || []) {
          nameById[p.id] = { name: p.name, avatar_url: p.avatar_url };
        }
      }
      return rows.map((r) => ({
        ...r,
        sender_name: nameById[r.sender_id]?.name || null,
        sender_avatar_url: nameById[r.sender_id]?.avatar_url || null,
      })) as RideChatMessage[];
    },
  });

  useEffect(() => {
    if (!rideId) return;
    const channel = supabase
      .channel(`ride-chat-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ride_chat_messages',
          filter: `ride_id=eq.${rideId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride-chat', rideId] });
          queryClient.invalidateQueries({ queryKey: ['cleaner-city-chat-inbox'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [rideId, queryClient]);

  return query;
}

export function useSendRideChat() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ride_id: string; society_id: string; body: string }) => {
      const { error } = await supabase.from('ride_chat_messages').insert({
        ride_id: input.ride_id,
        society_id: input.society_id,
        sender_id: user.id,
        body: input.body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride-chat', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-chat-inbox'] });
    },
  });
}

export function useCircleChat(circleId?: string) {
  return useQuery({
    queryKey: ['cleaner-city-circle-chat', circleId],
    enabled: !!circleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_circle_messages')
        .select('id, sender_id, body, created_at')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: true })
        .limit(40);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSendCircleChat() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { circle_id: string; society_id: string; body: string }) => {
      const { error } = await supabase.from('commute_circle_messages').insert({
        circle_id: input.circle_id,
        society_id: input.society_id,
        sender_id: user.id,
        body: input.body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-circle-chat', vars.circle_id] });
    },
  });
}

export function useRankedMeetupPoints(rideId?: string) {
  return useQuery({
    queryKey: ['cleaner-city-ranked-meetup', rideId],
    enabled: !!rideId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_rank_meetup_points', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        label: string;
        kind: string;
        latitude: number;
        longitude: number;
        walk_meters: number;
        detour_minutes: number;
      }>;
    },
  });
}

export type RideDisputeCase = {
  id: string;
  ride_id: string;
  society_id: string | null;
  opened_by: string;
  prior_status: string | null;
  note: string | null;
  status: string;
  appeal_note: string | null;
  appeal_by: string | null;
  appealed_at: string | null;
  created_at?: string;
};

export function useRideDisputeCase(rideId: string | null | undefined) {
  return useQuery({
    queryKey: ['cleaner-city-dispute-case', rideId],
    enabled: !!rideId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_dispute_cases')
        .select(
          'id, ride_id, society_id, opened_by, prior_status, note, status, appeal_note, appeal_by, appealed_at, created_at',
        )
        .eq('ride_id', rideId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as RideDisputeCase | null;
    },
  });
}

export function useAppealDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ride_id: string; note: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_appeal_dispute', {
        p_ride_id: input.ride_id,
        p_note: input.note,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-dispute-case', vars.ride_id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-ride', vars.ride_id] });
    },
  });
}

export type PublicationStop = {
  id: string;
  publication_id: string;
  seq: number;
  label: string;
  latitude: number;
  longitude: number;
};

export function usePublicationStops(publicationId: string | null | undefined) {
  return useQuery({
    queryKey: ['cleaner-city-publication-stops', publicationId],
    enabled: !!publicationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_publication_stops')
        .select('id, publication_id, seq, label, latitude, longitude')
        .eq('publication_id', publicationId!)
        .order('seq', { ascending: true });
      if (error) throw error;
      return (data || []) as PublicationStop[];
    },
  });
}

export function useSetPublicationStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      publication_id: string;
      seq: number;
      label: string;
      latitude: number;
      longitude: number;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_set_publication_stop', {
        p_publication_id: input.publication_id,
        p_seq: input.seq,
        p_label: input.label,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['cleaner-city-publication-stops', vars.publication_id],
      });
    },
  });
}

export type ChatInboxRow = {
  kind: string;
  thread_id: string;
  ride_id?: string | null;
  circle_id?: string | null;
  other_user_id?: string | null;
  society_id?: string | null;
  title?: string | null;
  last_body?: string | null;
  last_at?: string | null;
  partner_name?: string | null;
  partner_avatar_url?: string | null;
  partner_flat?: string | null;
  ride_status?: string | null;
  depart_time?: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
  meeting_point_label?: string | null;
};

export function useCleanerCityChatInbox() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-chat-inbox', user?.id],
    enabled: !!user?.id,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_chat_inbox');
      if (error) throw error;
      const rows = (data || []) as ChatInboxRow[];
      const rideIds = [
        ...new Set(
          rows
            .filter((r) => r.kind === 'ride')
            .map((r) => r.ride_id || r.thread_id)
            .filter(Boolean) as string[],
        ),
      ];
      const otherIds = [
        ...new Set(rows.map((r) => r.other_user_id).filter(Boolean) as string[]),
      ];

      let rideById: Record<
        string,
        {
          status?: string | null;
          host_user_id?: string;
          guest_user_id?: string;
          publication_id?: string | null;
          meeting_point_label?: string | null;
        }
      > = {};
      let pubById: Record<
        string,
        { depart_time?: string | null; origin_label?: string | null; destination_label?: string | null }
      > = {};
      let profileById: Record<
        string,
        { name?: string | null; avatar_url?: string | null; flat_number?: string | null }
      > = {};

      if (rideIds.length) {
        const { data: rides } = await supabase
          .from('rides')
          .select(
            'id, status, host_user_id, guest_user_id, publication_id, meeting_point_label',
          )
          .in('id', rideIds);
        for (const r of rides || []) {
          rideById[r.id] = r;
          if (r.host_user_id) otherIds.push(r.host_user_id);
          if (r.guest_user_id) otherIds.push(r.guest_user_id);
        }
        const pubIds = [
          ...new Set(
            (rides || []).map((r) => r.publication_id).filter(Boolean) as string[],
          ),
        ];
        if (pubIds.length) {
          const { data: pubs } = await supabase
            .from('commute_publications')
            .select('id, depart_time, origin_label, destination_label')
            .in('id', pubIds);
          for (const p of pubs || []) pubById[p.id] = p;
        }
      }

      const uniqueOthers = [...new Set(otherIds)];
      if (uniqueOthers.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url, flat_number')
          .in('id', uniqueOthers);
        for (const p of profiles || []) {
          profileById[p.id] = p;
        }
      }

      const ACTIVE = ['requested', 'confirmed', 'pickup_pending', 'started'];
      const enriched = rows.map((row) => {
        if (row.kind !== 'ride') {
          const partner = row.other_user_id ? profileById[row.other_user_id] : null;
          return {
            ...row,
            partner_name: partner?.name || null,
            partner_avatar_url: partner?.avatar_url || null,
            partner_flat: partner?.flat_number || null,
          };
        }
        const rid = row.ride_id || row.thread_id;
        const ride = rid ? rideById[rid] : null;
        const partnerId =
          ride && user?.id
            ? ride.host_user_id === user.id
              ? ride.guest_user_id
              : ride.host_user_id
            : row.other_user_id;
        const partner = partnerId ? profileById[partnerId] : null;
        const pub = ride?.publication_id ? pubById[ride.publication_id] : null;
        return {
          ...row,
          ride_id: rid,
          partner_name: partner?.name || null,
          partner_avatar_url: partner?.avatar_url || null,
          partner_flat: partner?.flat_number || null,
          ride_status: ride?.status || null,
          depart_time: pub?.depart_time || null,
          origin_label: pub?.origin_label || null,
          destination_label: pub?.destination_label || null,
          meeting_point_label: ride?.meeting_point_label || null,
        };
      });

      enriched.sort((a, b) => {
        const aActive = a.kind === 'ride' && ACTIVE.includes(String(a.ride_status || '')) ? 0 : 1;
        const bActive = b.kind === 'ride' && ACTIVE.includes(String(b.ride_status || '')) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        const at = a.last_at ? Date.parse(a.last_at) : 0;
        const bt = b.last_at ? Date.parse(b.last_at) : 0;
        return bt - at;
      });

      return enriched;
    },
  });
}

export function useDirectChat(otherUserId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-direct-chat', user?.id, otherUserId],
    enabled: !!user?.id && !!otherUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_direct_messages')
        .select('id, sender_id, recipient_id, body, created_at')
        .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${user.id})`)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSendDirectChat() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { recipient_id: string; body: string }) => {
      const { data, error } = await supabase.rpc('cleaner_city_send_direct_message', {
        p_recipient: input.recipient_id,
        p_body: input.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-direct-chat', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-chat-inbox', user?.id] });
    },
  });
}
