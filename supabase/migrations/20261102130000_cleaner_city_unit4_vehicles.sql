-- A Cleaner City Unit 4: host vehicles, docs metadata, commute publish.
-- Exit gate: no publication with invalid capacity or unverified work email.

CREATE TABLE IF NOT EXISTS public.vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  document_type text NOT NULL
    CHECK (document_type IN ('registration', 'insurance', 'licence', 'other')),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
  label text,
  storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle
  ON public.vehicle_documents (vehicle_id, document_type);

ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_documents_select ON public.vehicle_documents;
CREATE POLICY vehicle_documents_select ON public.vehicle_documents
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS vehicle_documents_write ON public.vehicle_documents;
CREATE POLICY vehicle_documents_write ON public.vehicle_documents
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS feature_gate_vehicle_documents_write ON public.vehicle_documents;
CREATE POLICY feature_gate_vehicle_documents_write ON public.vehicle_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(society_id, 'cleaner_city')
  );

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS preferred_pickup_label text,
  ADD COLUMN IF NOT EXISTS preferred_drop_label text;

CREATE OR REPLACE FUNCTION public.cleaner_city_assert_host_access(p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid;
  v_role text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(p_uid);
  v_society := public.get_user_society_id(p_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;
  IF NOT public.can_access_feature(v_society, 'cleaner_city') AND NOT public.is_admin(p_uid) THEN
    RAISE EXCEPTION 'A Cleaner City is not enabled for this society';
  END IF;
  SELECT cp.role INTO v_role
  FROM public.commute_profiles cp
  WHERE cp.user_id = p_uid AND cp.deleted_at IS NULL;
  IF v_role IS NULL OR v_role NOT IN ('host', 'both') THEN
    RAISE EXCEPTION 'Host role required to manage vehicles or publish rides';
  END IF;
  RETURN v_society;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_assert_host_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_assert_host_access(uuid) TO authenticated, service_role;

-- Upsert vehicle. Bike seat capacity hard-capped at 1 passenger seat.
CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_vehicle(
  p_vehicle_id uuid DEFAULT NULL,
  p_vehicle_type text DEFAULT 'car',
  p_make text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_registration_number text DEFAULT NULL,
  p_seat_capacity integer DEFAULT 3,
  p_is_active boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_preferred_pickup_label text DEFAULT NULL,
  p_preferred_drop_label text DEFAULT NULL
)
RETURNS public.vehicles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_seats integer;
  v_row public.vehicles;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_vehicle_type IS NULL OR p_vehicle_type NOT IN ('car', 'bike') THEN
    RAISE EXCEPTION 'vehicle_type must be car or bike';
  END IF;

  v_seats := COALESCE(p_seat_capacity, CASE WHEN p_vehicle_type = 'bike' THEN 1 ELSE 3 END);
  IF p_vehicle_type = 'bike' THEN
    IF v_seats < 1 OR v_seats > 1 THEN
      RAISE EXCEPTION 'Bike passenger seat capacity must be exactly 1';
    END IF;
  ELSE
    IF v_seats < 1 OR v_seats > 8 THEN
      RAISE EXCEPTION 'Car seat capacity must be between 1 and 8';
    END IF;
  END IF;

  IF NULLIF(trim(COALESCE(p_registration_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'registration_number is required';
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles v
    SET
      vehicle_type = p_vehicle_type,
      make = NULLIF(trim(COALESCE(p_make, '')), ''),
      model = NULLIF(trim(COALESCE(p_model, '')), ''),
      color = NULLIF(trim(COALESCE(p_color, '')), ''),
      registration_number = upper(trim(p_registration_number)),
      seat_capacity = v_seats,
      is_active = COALESCE(p_is_active, true),
      notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
      preferred_pickup_label = NULLIF(trim(COALESCE(p_preferred_pickup_label, '')), ''),
      preferred_drop_label = NULLIF(trim(COALESCE(p_preferred_drop_label, '')), ''),
      society_id = v_society,
      updated_at = now()
    WHERE v.id = p_vehicle_id AND v.user_id = v_uid
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Vehicle not found';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO public.vehicles (
    user_id, society_id, vehicle_type, make, model, color, registration_number,
    seat_capacity, is_active, notes, preferred_pickup_label, preferred_drop_label, updated_at
  )
  VALUES (
    v_uid, v_society, p_vehicle_type,
    NULLIF(trim(COALESCE(p_make, '')), ''),
    NULLIF(trim(COALESCE(p_model, '')), ''),
    NULLIF(trim(COALESCE(p_color, '')), ''),
    upper(trim(p_registration_number)),
    v_seats,
    COALESCE(p_is_active, true),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    NULLIF(trim(COALESCE(p_preferred_pickup_label, '')), ''),
    NULLIF(trim(COALESCE(p_preferred_drop_label, '')), ''),
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_vehicle(
  uuid, text, text, text, text, text, integer, boolean, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_vehicle(
  uuid, text, text, text, text, text, integer, boolean, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_deactivate_vehicle(p_vehicle_id uuid)
RETURNS public.vehicles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.vehicles;
BEGIN
  PERFORM public.cleaner_city_assert_host_access(v_uid);

  UPDATE public.vehicles
  SET is_active = false, updated_at = now()
  WHERE id = p_vehicle_id AND user_id = v_uid
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  -- Cancel future draft/published seats tied to this vehicle
  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE vehicle_id = p_vehicle_id
    AND host_user_id = v_uid
    AND status IN ('draft', 'published')
    AND travel_date >= CURRENT_DATE;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_deactivate_vehicle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_deactivate_vehicle(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_vehicle_document(
  p_vehicle_id uuid,
  p_document_type text,
  p_label text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_document_id uuid DEFAULT NULL
)
RETURNS public.vehicle_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_owner uuid;
  v_row public.vehicle_documents;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_document_type IS NULL OR p_document_type NOT IN ('registration', 'insurance', 'licence', 'other') THEN
    RAISE EXCEPTION 'Invalid document_type';
  END IF;

  SELECT user_id INTO v_owner FROM public.vehicles WHERE id = p_vehicle_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF p_document_id IS NOT NULL THEN
    UPDATE public.vehicle_documents d
    SET
      document_type = p_document_type,
      label = NULLIF(trim(COALESCE(p_label, '')), ''),
      storage_path = NULLIF(trim(COALESCE(p_storage_path, '')), ''),
      notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
      status = 'uploaded',
      updated_at = now()
    WHERE d.id = p_document_id AND d.user_id = v_uid AND d.vehicle_id = p_vehicle_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Document not found';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO public.vehicle_documents (
    vehicle_id, user_id, society_id, document_type, status, label, storage_path, notes, updated_at
  )
  VALUES (
    p_vehicle_id, v_uid, v_society, p_document_type, 'uploaded',
    NULLIF(trim(COALESCE(p_label, '')), ''),
    NULLIF(trim(COALESCE(p_storage_path, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_vehicle_document(
  uuid, text, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_vehicle_document(
  uuid, text, text, text, text, uuid
) TO authenticated;

-- Publish seats for a date. Requires verified work email + active vehicle + valid capacity.
CREATE OR REPLACE FUNCTION public.cleaner_city_publish_commute(
  p_vehicle_id uuid,
  p_travel_date date,
  p_direction text DEFAULT 'to_office',
  p_depart_time time DEFAULT NULL,
  p_seats_available integer DEFAULT NULL,
  p_route_polyline text DEFAULT NULL,
  p_publication_id uuid DEFAULT NULL
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_vehicle public.vehicles;
  v_seats integer;
  v_depart time;
  v_effective jsonb;
  v_row public.commute_publications;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_travel_date IS NULL OR p_travel_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'travel_date must be today or a future date';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id AND user_id = v_uid AND is_active = true;

  IF v_vehicle.id IS NULL THEN
    RAISE EXCEPTION 'Active vehicle required to publish a ride';
  END IF;

  v_effective := public.cleaner_city_effective_schedule(v_uid, p_travel_date);
  IF COALESCE((v_effective->>'is_paused')::boolean, false) THEN
    RAISE EXCEPTION 'Commute is paused - resume before publishing';
  END IF;
  IF NOT COALESCE((v_effective->>'is_working')::boolean, false) THEN
    RAISE EXCEPTION 'Not commuting on this date - update schedule or override first';
  END IF;

  IF p_direction = 'to_office' THEN
    v_depart := COALESCE(p_depart_time, (v_effective->>'depart_time')::time);
  ELSE
    v_depart := COALESCE(p_depart_time, (v_effective->>'return_time')::time);
  END IF;

  IF v_depart IS NULL THEN
    RAISE EXCEPTION 'depart_time required to publish';
  END IF;

  v_seats := COALESCE(p_seats_available, v_vehicle.seat_capacity);
  IF v_seats IS NULL OR v_seats < 1 THEN
    RAISE EXCEPTION 'seats_available must be at least 1';
  END IF;
  IF v_seats > v_vehicle.seat_capacity THEN
    RAISE EXCEPTION 'Cannot publish more seats than vehicle capacity';
  END IF;
  IF v_vehicle.vehicle_type = 'bike' AND v_seats > 1 THEN
    RAISE EXCEPTION 'Bike publications cannot offer more than 1 passenger seat';
  END IF;

  IF p_publication_id IS NOT NULL THEN
    UPDATE public.commute_publications p
    SET
      vehicle_id = p_vehicle_id,
      travel_date = p_travel_date,
      direction = p_direction,
      depart_time = v_depart,
      seats_available = v_seats,
      seats_total = v_vehicle.seat_capacity,
      route_polyline = COALESCE(NULLIF(trim(COALESCE(p_route_polyline, '')), ''), p.route_polyline),
      status = 'published',
      society_id = v_society,
      updated_at = now()
    WHERE p.id = p_publication_id
      AND p.host_user_id = v_uid
      AND p.status IN ('draft', 'published')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Publication not found or not editable';
    END IF;
    RETURN v_row;
  END IF;

  -- One active publication per host/date/direction
  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE host_user_id = v_uid
    AND travel_date = p_travel_date
    AND direction = p_direction
    AND status IN ('draft', 'published');

  INSERT INTO public.commute_publications (
    host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
    seats_available, seats_total, status, route_polyline, updated_at
  )
  VALUES (
    v_uid, v_society, p_vehicle_id, p_travel_date, p_direction, v_depart,
    v_seats, v_vehicle.seat_capacity, 'published',
    NULLIF(trim(COALESCE(p_route_polyline, '')), ''),
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_publish_commute(
  uuid, date, text, time, integer, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_publish_commute(
  uuid, date, text, time, integer, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_cancel_publication(p_publication_id uuid)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_publications;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_publication_id
    AND host_user_id = v_uid
    AND status IN ('draft', 'published', 'full')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Publication not found or already closed';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_cancel_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_cancel_publication(uuid) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_upsert_vehicle IS
  'Unit 4: car/bike profile upsert with bike seat cap enforced.';
COMMENT ON FUNCTION public.cleaner_city_publish_commute IS
  'Unit 4 exit gate: verified work email + active vehicle + valid seat capacity required.';
