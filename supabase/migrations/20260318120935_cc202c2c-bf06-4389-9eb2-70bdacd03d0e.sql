
CREATE OR REPLACE FUNCTION public.trg_create_seller_delivery_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _buyer_society uuid;
  _seller_society uuid;
  _resolved_society uuid;
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

  SELECT sp.user_id, sp.business_name, sp.society_id, sp.latitude, sp.longitude, p.phone
  INTO _seller_user_id, _seller_name, _seller_society, _seller_lat, _seller_lng, _seller_phone
  FROM seller_profiles sp
  JOIN profiles p ON p.id = sp.user_id
  WHERE sp.id = NEW.seller_id;

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = NEW.buyer_id;

  -- Resolve society: buyer's society -> order's society -> seller's society
  _resolved_society := COALESCE(_buyer_society, NEW.society_id, _seller_society);

  -- If still null, skip creating the assignment rather than failing
  IF _resolved_society IS NULL THEN
    RAISE NOTICE 'trg_create_seller_delivery_assignment: no society_id found for order %, skipping', NEW.id;
    RETURN NEW;
  END IF;

  _idempotency := 'seller_delivery_' || NEW.id::text || '_' || extract(epoch from now())::text;

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
    NEW.id, _resolved_society, COALESCE(NEW.delivery_fee, 0), _idempotency,
    _seller_name, _seller_phone, 'picked_up',
    _seller_lat, _seller_lng,
    _initial_eta, _distance_m::int
  );

  RETURN NEW;
END;
$function$;
