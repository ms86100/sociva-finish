
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
  _is_transit_step boolean;
  _v_parent_group text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type NOT IN ('delivery', 'seller_delivery') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _v_parent_group
  FROM seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Workflow-driven: check is_transit AND actor includes seller
  SELECT EXISTS (
    SELECT 1 FROM category_status_flows
    WHERE status_key = NEW.status
      AND is_transit = true
      AND actor LIKE '%seller%'
      AND transaction_type = COALESCE(NEW.transaction_type, 'seller_delivery')
      AND parent_group IN (COALESCE(_v_parent_group, 'default'), 'default')
      AND is_deprecated = false
  ) INTO _is_transit_step;

  IF NOT _is_transit_step THEN RETURN NEW; END IF;

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
    _seller_name, _seller_phone, NEW.status,
    _seller_lat, _seller_lng,
    _initial_eta, _distance_m::int,
    _delivery_code
  );

  RETURN NEW;
END;
$function$;
