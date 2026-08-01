
-- Fix: trg_compute_delivery_eta declares _seller_id_val as text but compares it to uuid columns
CREATE OR REPLACE FUNCTION public.trg_compute_delivery_eta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_lat numeric;
  _seller_lng numeric;
  _dest_lat numeric;
  _dest_lng numeric;
  _distance_m numeric;
  _avg_prep_min numeric;
  _avg_delivery_min numeric;
  _total_eta_min numeric;
  _seller_id_val uuid;
  _society_id_val uuid;
  _current_hour int;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'accepted' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.fulfillment_type, 'self_pickup') != 'delivery' THEN RETURN NEW; END IF;
  IF NEW.estimated_delivery_at IS NOT NULL THEN RETURN NEW; END IF;

  _seller_id_val := NEW.seller_id;

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
$function$;
