// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
      const { data, error } = await supabase.functions.invoke('cleaner-city-work-email-otp', {
        body: { action: 'send', email },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });

  const verify = useMutation({
    mutationFn: async (input: { email: string; code: string }) => {
      const { data, error } = await supabase.functions.invoke('cleaner-city-work-email-otp', {
        body: { action: 'verify', email: input.email, code: input.code },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-work-verification'] });
    },
  });

  return { send, verify };
}

export function useCommuteTemplates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-templates', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commute_templates')
        .select('id, weekday, is_working, depart_time, return_time, pickup_label')
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
      return data as CommuteTemplate;
    },
    onSuccess: () => invalidateSchedule(queryClient, user?.id),
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
      return data as CommuteOverride;
    },
    onSuccess: () => invalidateSchedule(queryClient, user?.id),
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
  depart_time: string;
  seats_available: number;
  seats_total: number;
  status: string;
  vehicle_id: string | null;
  route_polyline: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
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
      document_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('cleaner_city_upsert_vehicle_document', {
        p_vehicle_id: input.vehicle_id,
        p_document_type: input.document_type,
        p_label: input.label ?? null,
        p_storage_path: null,
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
          'id, travel_date, direction, depart_time, seats_available, seats_total, status, vehicle_id, route_polyline, origin_label, destination_label',
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
  host_company: string | null;
  origin_label: string;
  destination_label: string;
  has_route: boolean;
  estimated_detour_minutes: number | null;
  score: number;
  reasons: string[];
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
      return data as MatchResponse;
    },
  });
}

export function useMyRides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-rides', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rides')
        .select('id, publication_id, host_user_id, guest_user_id, travel_date, status')
        .or(`host_user_id.eq.${user!.id},guest_user_id.eq.${user!.id}`)
        .order('travel_date', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data || []) as CleanerCityRide[];
    },
  });
}

export function useRequestRide() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { publication_id: string; note?: string | null }) => {
      const { data, error } = await supabase.rpc('cleaner_city_request_ride', {
        p_publication_id: input.publication_id,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      return data as CleanerCityRide;
    },
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-publications'] });
    },
  });
}

export function useCleanerCityRide(rideId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['cleaner-city-ride', rideId, user?.id],
    enabled: !!user?.id && !!rideId,
    refetchInterval: (q) => {
      const status = (q.state.data as CleanerCityRide | undefined)?.status;
      return status && ['pickup_pending', 'started'].includes(status) ? 8000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rides')
        .select('id, publication_id, host_user_id, guest_user_id, travel_date, status')
        .eq('id', rideId!)
        .maybeSingle();
      if (error) throw error;
      return data as CleanerCityRide | null;
    },
  });
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
  return useMutation({
    mutationFn: async (rideId: string) => {
      const { data, error } = await supabase.rpc('cleaner_city_create_share_token', {
        p_ride_id: rideId,
      });
      if (error) throw error;
      return data as { token: string; expires_at: string };
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
