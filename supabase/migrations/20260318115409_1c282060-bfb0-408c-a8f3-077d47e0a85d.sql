
-- Fix: p.latitude/p.longitude → sp.latitude/sp.longitude in both trigger functions
-- profiles table does NOT have latitude/longitude columns; seller_profiles does

-- Fix 1: trg_compute_delivery_eta
CREATE OR REPLACE FUNCTION public.trg_compute_delivery_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _seller_lat numeric;
  _seller_lng numeric;
  _dest_lat numeric;
  _dest_lng numeric;
  _distance_m numeric;
  _avg_prep_min numeric;
  _avg_delivery_min numeric;
  _total_eta_min numeric;
  _seller_id_val text;
  _society_id_val uuid;
  _current_hour int;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'accepted' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.fulfillment_type, 'self_pickup') != 'delivery' THEN RETURN NEW; END IF;
  IF NEW.estimated_delivery_at IS NOT NULL THEN RETURN NEW; END IF;

  _seller_id_val := NEW.seller_id;

  -- Fix: select from seller_profiles directly (latitude/longitude live there, not on profiles)
  SELECT sp.latitude, sp.longitude INTO _seller_lat, _seller_lng
  FROM seller_profiles sp
  WHERE sp.id = _seller_id_val;

  _dest_lat := NEW.delivery_lat;
  _dest_lng := NEW.delivery_lng;

  _avg_prep_min := 10;
  _avg_delivery_min := 15;

  _society_id_val := NEW.buyer_society_id;
  _current_hour := extract(hour from now() at time zone 'UTC');

  SELECT dts.avg_prep_minutes, dts.avg_delivery_minutes
  INTO _avg_prep_min, _avg_delivery_min
  FROM delivery_time_stats dts
  WHERE dts.seller_id = _seller_id_val
    AND dts.society_id = _society_id_val
    AND dts.time_bucket = _current_hour
  LIMIT 1;

  _avg_prep_min := COALESCE(_avg_prep_min, 10);
  _avg_delivery_min := COALESCE(_avg_delivery_min, 15);

  IF _seller_lat IS NOT NULL AND _seller_lng IS NOT NULL AND _dest_lat IS NOT NULL AND _dest_lng IS NOT NULL THEN
    _distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians((_dest_lat - _seller_lat) / 2)), 2) +
      cos(radians(_seller_lat)) * cos(radians(_dest_lat)) *
      power(sin(radians((_dest_lng - _seller_lng) / 2)), 2)
    ));
    _avg_delivery_min := GREATEST(_avg_delivery_min, round((_distance_m * 1.3 / 1000.0 / 15.0) * 60));
  END IF;

  _total_eta_min := _avg_prep_min + _avg_delivery_min;
  NEW.estimated_delivery_at := now() + (_total_eta_min || ' minutes')::interval;

  RETURN NEW;
END;
$$;

-- Fix 2: trg_create_seller_delivery_assignment
CREATE OR REPLACE FUNCTION public.trg_create_seller_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _buyer_society uuid;
  _idempotency text;
  _seller_user_id uuid;
  _seller_name text;
  _seller_phone text;
  _seller_lat numeric;
  _seller_lng numeric;
  _dest_lat numeric;
  _dest_lng numeric;
  _distance_m numeric;
  _initial_eta int;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'picked_up' THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type NOT IN ('delivery', 'seller_delivery') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT sp.user_id, sp.business_name, p.phone
  INTO _seller_user_id, _seller_name, _seller_phone
  FROM seller_profiles sp
  JOIN profiles p ON p.id = sp.user_id
  WHERE sp.id = NEW.seller_id;

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = NEW.buyer_id;

  _idempotency := 'seller_delivery_' || NEW.id::text || '_' || extract(epoch from now())::text;

  -- Fix: select from seller_profiles directly
  SELECT sp.latitude, sp.longitude INTO _seller_lat, _seller_lng
  FROM seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  _dest_lat := NEW.delivery_lat;
  _dest_lng := NEW.delivery_lng;

  IF _seller_lat IS NOT NULL AND _seller_lng IS NOT NULL AND _dest_lat IS NOT NULL AND _dest_lng IS NOT NULL THEN
    _distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians((_dest_lat - _seller_lat) / 2)), 2) +
      cos(radians(_seller_lat)) * cos(radians(_dest_lat)) *
      power(sin(radians((_dest_lng - _seller_lng) / 2)), 2)
    ));
    _initial_eta := GREATEST(2, round((_distance_m * 1.3 / 1000.0 / 15.0) * 60));
  END IF;

  INSERT INTO delivery_assignments (
    order_id, society_id, delivery_fee, idempotency_key,
    rider_name, rider_phone, status,
    last_location_lat, last_location_lng,
    eta_minutes, distance_meters
  )
  VALUES (
    NEW.id, COALESCE(_buyer_society, NEW.society_id), COALESCE(NEW.delivery_fee, 0), _idempotency,
    _seller_name, _seller_phone, 'picked_up',
    _seller_lat, _seller_lng,
    _initial_eta, _distance_m::int
  );

  RETURN NEW;
END;
$$;
