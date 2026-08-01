
-- Fix: Generate delivery_code inline during assignment INSERT (solves trigger race condition)
-- The old generate_delivery_code trigger on orders.UPDATE fires in the same snapshot as
-- trg_create_seller_delivery_assignment, so it can't see the newly inserted assignment.

-- Step 1: Update trg_create_seller_delivery_assignment to generate code at INSERT time
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
  _delivery_code text;
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

  _resolved_society := COALESCE(_buyer_society, NEW.society_id, _seller_society);

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

  -- Generate 4-digit delivery code inline (fixes race condition with generate_delivery_code trigger)
  _delivery_code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  INSERT INTO delivery_assignments (
    order_id, society_id, delivery_fee, idempotency_key,
    rider_name, rider_phone, status,
    last_location_lat, last_location_lng,
    eta_minutes, distance_meters,
    delivery_code
  )
  VALUES (
    NEW.id, _resolved_society, COALESCE(NEW.delivery_fee, 0), _idempotency,
    _seller_name, _seller_phone, 'picked_up',
    _seller_lat, _seller_lng,
    _initial_eta, _distance_m::int,
    _delivery_code
  );

  RETURN NEW;
END;
$function$;

-- Step 2: Safety net trigger on delivery_assignments INSERT for platform-assigned deliveries
CREATE OR REPLACE FUNCTION public.ensure_delivery_code_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_code IS NULL THEN
    NEW.delivery_code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_delivery_code ON public.delivery_assignments;
CREATE TRIGGER trg_ensure_delivery_code
  BEFORE INSERT ON public.delivery_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_delivery_code_on_insert();

-- Step 3: Backfill any existing NULL codes on active assignments
UPDATE public.delivery_assignments
SET delivery_code = LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
WHERE delivery_code IS NULL
  AND status NOT IN ('delivered', 'completed', 'cancelled', 'failed');
