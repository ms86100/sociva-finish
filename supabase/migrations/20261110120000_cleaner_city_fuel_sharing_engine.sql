-- Cleaner City automatic fuel-sharing engine
-- Admin configures petrol ₹/L only. Mileage constant = 10 km/L.
-- No host/guest manual fuel amounts for settlement happy path.

-- ---------------------------------------------------------------------------
-- Config + history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleaner_city_fuel_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  petrol_paise_per_litre integer NOT NULL CHECK (petrol_paise_per_litre > 0),
  set_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cleaner_city_fuel_price_history_created_idx
  ON public.cleaner_city_fuel_price_history (created_at DESC);

ALTER TABLE public.cleaner_city_fuel_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_city_fuel_price_history_admin_all ON public.cleaner_city_fuel_price_history;
CREATE POLICY cleaner_city_fuel_price_history_admin_all
  ON public.cleaner_city_fuel_price_history
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.admin_settings (key, value, description, is_active)
VALUES (
  'cleaner_city_petrol_paise_per_litre',
  '12000',
  'Cleaner City petrol price per litre in paise (admin-controlled fuel sharing)',
  true
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.cleaner_city_fuel_price_history (petrol_paise_per_litre, note)
SELECT 12000, 'Initial default Rs 120/L'
WHERE NOT EXISTS (SELECT 1 FROM public.cleaner_city_fuel_price_history LIMIT 1);

-- Snapshot columns on rides
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS fuel_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS fuel_petrol_paise_per_litre integer,
  ADD COLUMN IF NOT EXISTS fuel_mileage_km_per_litre integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS fuel_distance_meters double precision,
  ADD COLUMN IF NOT EXISTS fuel_total_paise integer,
  ADD COLUMN IF NOT EXISTS fuel_host_share_paise integer,
  ADD COLUMN IF NOT EXISTS fuel_calc_version integer;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_current_petrol_paise_per_litre()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text;
  v_paise integer;
BEGIN
  SELECT value INTO v
  FROM public.admin_settings
  WHERE key = 'cleaner_city_petrol_paise_per_litre' AND COALESCE(is_active, true)
  LIMIT 1;
  v_paise := NULLIF(trim(COALESCE(v, '')), '')::integer;
  IF v_paise IS NULL OR v_paise <= 0 THEN
    RETURN 12000;
  END IF;
  RETURN v_paise;
EXCEPTION WHEN others THEN
  RETURN 12000;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_current_petrol_paise_per_litre() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_current_petrol_paise_per_litre() TO authenticated, service_role;

-- Guest share estimate: (distance_km * petrol/10) / seats_total
CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_fuel_paise(
  p_distance_meters double precision,
  p_seats integer DEFAULT 2
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km double precision;
  v_petrol integer;
  v_per_km numeric;
  v_total numeric;
  v_participants integer;
  v_share integer;
BEGIN
  IF p_distance_meters IS NULL OR p_distance_meters <= 0 THEN
    RETURN NULL;
  END IF;
  v_petrol := public.cleaner_city_current_petrol_paise_per_litre();
  v_km := p_distance_meters / 1000.0;
  -- Mileage constant 10 km/L → paise per km = petrol_paise / 10
  v_per_km := v_petrol::numeric / 10.0;
  v_total := v_km * v_per_km;
  v_participants := greatest(COALESCE(p_seats, 2), 2);
  v_share := round(v_total / v_participants)::integer;
  IF v_share < 1 THEN
    RETURN NULL;
  END IF;
  RETURN v_share;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_estimate_fuel_paise(double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_estimate_fuel_paise(double precision, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_get_fuel_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paise integer;
  v_hist jsonb;
  v_last record;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  v_paise := public.cleaner_city_current_petrol_paise_per_litre();
  SELECT * INTO v_last
  FROM public.cleaner_city_fuel_price_history
  ORDER BY created_at DESC
  LIMIT 1;
  SELECT coalesce(jsonb_agg(row_to_json(h) ORDER BY h.created_at DESC), '[]'::jsonb)
  INTO v_hist
  FROM (
    SELECT id, petrol_paise_per_litre, set_by, note, created_at
    FROM public.cleaner_city_fuel_price_history
    ORDER BY created_at DESC
    LIMIT 20
  ) h;
  RETURN jsonb_build_object(
    'petrol_paise_per_litre', v_paise,
    'petrol_rupees_per_litre', round(v_paise / 100.0, 2),
    'mileage_km_per_litre', 10,
    'fuel_paise_per_km', round(v_paise / 10.0)::integer,
    'last_updated_at', v_last.created_at,
    'last_updated_by', v_last.set_by,
    'history', v_hist
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_get_fuel_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_get_fuel_config() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_set_petrol_price(
  p_petrol_rupees numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paise integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_petrol_rupees IS NULL OR p_petrol_rupees <= 0 OR p_petrol_rupees > 500 THEN
    RAISE EXCEPTION 'Petrol price must be between 0 and 500 INR per litre';
  END IF;
  v_paise := round(p_petrol_rupees * 100)::integer;
  INSERT INTO public.admin_settings (key, value, description, is_active)
  VALUES (
    'cleaner_city_petrol_paise_per_litre',
    v_paise::text,
    'Cleaner City petrol price per litre in paise (admin-controlled fuel sharing)',
    true
  )
  ON CONFLICT (key) DO UPDATE
  SET value = excluded.value,
      description = excluded.description,
      is_active = true,
      updated_at = now();

  INSERT INTO public.cleaner_city_fuel_price_history (petrol_paise_per_litre, set_by, note)
  VALUES (v_paise, auth.uid(), NULLIF(trim(COALESCE(p_note, '')), ''));

  RETURN public.cleaner_city_admin_get_fuel_config();
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_set_petrol_price(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_set_petrol_price(numeric, text) TO authenticated;

-- Apply equal-route snapshot for a ride (confirmed guests only)
CREATE OR REPLACE FUNCTION public.cleaner_city_apply_fuel_snapshot(p_ride_id uuid)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_pub public.commute_publications%ROWTYPE;
  v_dist double precision;
  v_petrol integer;
  v_participants integer;
  v_total integer;
  v_share integer;
  v_host integer;
  v_guest integer;
  v_snapshot jsonb;
  v_confirmed integer;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  -- Keep existing snapshot if petrol already frozen (price change immunity)
  IF v_ride.fuel_snapshot IS NOT NULL
     AND v_ride.fuel_petrol_paise_per_litre IS NOT NULL
     AND v_ride.status IN ('confirmed', 'pickup_pending', 'started', 'completed') THEN
    v_petrol := v_ride.fuel_petrol_paise_per_litre;
  ELSE
    v_petrol := public.cleaner_city_current_petrol_paise_per_litre();
  END IF;

  IF v_ride.publication_id IS NOT NULL THEN
    SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id;
  END IF;

  v_dist := COALESCE(
    v_ride.fuel_distance_meters,
    CASE WHEN v_pub.route_distance_meters IS NOT NULL AND v_pub.route_distance_meters > 0
      THEN v_pub.route_distance_meters::double precision
      ELSE NULL
    END
  );

  IF v_dist IS NULL OR v_dist <= 0 THEN
    -- Fallback haversine guest OD or pub labels unavailable: leave estimate only
    UPDATE public.rides
    SET estimated_fuel_paise = COALESCE(
          estimated_fuel_paise,
          public.cleaner_city_estimate_fuel_paise(10000, 2)
        )
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    RETURN v_ride;
  END IF;

  SELECT count(*)::integer INTO v_confirmed
  FROM public.rides r
  WHERE r.publication_id = v_ride.publication_id
    AND r.status IN ('confirmed', 'pickup_pending', 'started', 'completed')
    AND r.host_user_id = v_ride.host_user_id;

  -- This ride's guest counts as 1 when confirming; include siblings on same pub
  v_participants := greatest(1 + greatest(v_confirmed, 1), 2);
  -- If only this ride is being confirmed, participants = host + this guest (+ other confirmed)
  IF v_confirmed = 0 THEN
    v_participants := 2;
  ELSE
    v_participants := 1 + v_confirmed;
  END IF;

  v_total := round((v_dist / 1000.0) * (v_petrol::numeric / 10.0))::integer;
  v_share := round(v_total::numeric / v_participants)::integer;
  v_guest := v_share;
  v_host := v_total - (v_share * (v_participants - 1));

  v_snapshot := jsonb_build_object(
    'petrol_paise_per_litre', v_petrol,
    'mileage_km_per_litre', 10,
    'distance_meters', v_dist,
    'fuel_paise_per_km', round(v_petrol::numeric / 10.0)::integer,
    'total_fuel_paise', v_total,
    'host_share_paise', v_host,
    'guest_share_paise', v_guest,
    'participants', v_participants,
    'calc_version', 1,
    'calculated_at', now(),
    'basis', 'route_distance'
  );

  UPDATE public.rides
  SET
    estimated_fuel_paise = v_guest,
    fuel_snapshot = v_snapshot,
    fuel_petrol_paise_per_litre = v_petrol,
    fuel_mileage_km_per_litre = 10,
    fuel_distance_meters = v_dist,
    fuel_total_paise = v_total,
    fuel_host_share_paise = v_host,
    fuel_calc_version = 1
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_apply_fuel_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_apply_fuel_snapshot(uuid) TO authenticated, service_role;

-- Auto-snapshot when a ride becomes confirmed
CREATE OR REPLACE FUNCTION public.cleaner_city_rides_fuel_snapshot_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('confirmed', 'pickup_pending') THEN
    PERFORM public.cleaner_city_apply_fuel_snapshot(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_rides_fuel_snapshot_trg ON public.rides;
CREATE TRIGGER cleaner_city_rides_fuel_snapshot_trg
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_city_rides_fuel_snapshot_trigger();

-- Settlement: calculated snapshot guest share (no manual propose required)
CREATE OR REPLACE FUNCTION public.cleaner_city_start_fuel_payment(p_ride_id uuid)
RETURNS public.ride_fuel_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_amount integer;
  v_row public.ride_fuel_payments;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the guest pays the fuel share';
  END IF;
  IF v_ride.status <> 'completed' THEN
    RAISE EXCEPTION 'Fuel is paid after the ride is completed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ride_fuel_payments
    WHERE ride_id = p_ride_id AND status = 'paid'
  ) THEN
    RAISE EXCEPTION 'Fuel for this ride is already paid';
  END IF;

  IF v_ride.fuel_snapshot IS NULL OR v_ride.estimated_fuel_paise IS NULL THEN
    PERFORM public.cleaner_city_apply_fuel_snapshot(p_ride_id);
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  END IF;

  IF v_ride.fuel_snapshot ? 'guest_share_paise' THEN
    v_amount := (v_ride.fuel_snapshot ->> 'guest_share_paise')::integer;
  ELSE
    v_amount := COALESCE(v_ride.estimated_fuel_paise, 0);
  END IF;

  IF v_amount IS NULL OR v_amount < 100 THEN
    RAISE EXCEPTION 'No calculated fuel share available for this ride';
  END IF;

  UPDATE public.ride_fuel_payments
  SET status = 'failed'
  WHERE ride_id = p_ride_id AND status = 'pending';

  INSERT INTO public.ride_fuel_payments (
    ride_id, cost_share_id, society_id, payer_id, payee_id, amount_paise, status, payout_status
  ) VALUES (
    v_ride.id, NULL, v_ride.society_id, v_uid, v_ride.host_user_id, v_amount, 'pending', 'unpaid'
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_start_fuel_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_start_fuel_payment(uuid) TO authenticated;

-- Public read of current petrol for transparent UX (no history)
CREATE OR REPLACE FUNCTION public.cleaner_city_get_fuel_public_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'petrol_paise_per_litre', public.cleaner_city_current_petrol_paise_per_litre(),
    'petrol_rupees_per_litre', round(public.cleaner_city_current_petrol_paise_per_litre() / 100.0, 2),
    'mileage_km_per_litre', 10,
    'fuel_paise_per_km', round(public.cleaner_city_current_petrol_paise_per_litre() / 10.0)::integer
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_get_fuel_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_get_fuel_public_config() TO authenticated, anon;
