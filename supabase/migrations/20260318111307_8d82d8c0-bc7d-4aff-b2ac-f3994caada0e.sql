
-- Gap 11: Add estimated_delivery_at to orders for buyer ETA display
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS estimated_delivery_at timestamptz;

-- Gap 11: Trigger to compute estimated delivery time when order is accepted
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
  -- Only fire on status change to accepted
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'accepted' THEN RETURN NEW; END IF;
  -- Only for delivery orders
  IF COALESCE(NEW.fulfillment_type, 'self_pickup') != 'delivery' THEN RETURN NEW; END IF;
  -- Skip if already set
  IF NEW.estimated_delivery_at IS NOT NULL THEN RETURN NEW; END IF;

  _seller_id_val := NEW.seller_id;

  -- Get seller location
  SELECT p.latitude, p.longitude INTO _seller_lat, _seller_lng
  FROM profiles p
  JOIN seller_profiles sp ON sp.user_id = p.id
  WHERE sp.id = _seller_id_val;

  _dest_lat := NEW.delivery_lat;
  _dest_lng := NEW.delivery_lng;

  -- Default prep time: 10 min
  _avg_prep_min := 10;
  -- Default delivery time: 15 min
  _avg_delivery_min := 15;

  -- Try to get historical stats
  _society_id_val := NEW.buyer_society_id;
  _current_hour := extract(hour from now() at time zone 'UTC');

  SELECT dts.avg_prep_minutes, dts.avg_delivery_minutes
  INTO _avg_prep_min, _avg_delivery_min
  FROM delivery_time_stats dts
  WHERE dts.seller_id = _seller_id_val
    AND dts.society_id = _society_id_val
    AND dts.time_bucket = _current_hour
  LIMIT 1;

  -- Use defaults if no stats
  _avg_prep_min := COALESCE(_avg_prep_min, 10);
  _avg_delivery_min := COALESCE(_avg_delivery_min, 15);

  -- If we have coordinates, compute haversine-based delivery time
  IF _seller_lat IS NOT NULL AND _seller_lng IS NOT NULL AND _dest_lat IS NOT NULL AND _dest_lng IS NOT NULL THEN
    _distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians((_dest_lat - _seller_lat) / 2)), 2) +
      cos(radians(_seller_lat)) * cos(radians(_dest_lat)) *
      power(sin(radians((_dest_lng - _seller_lng) / 2)), 2)
    ));
    -- Distance-based ETA: road factor 1.3, 15 km/h speed
    _avg_delivery_min := GREATEST(_avg_delivery_min, round((_distance_m * 1.3 / 1000.0 / 15.0) * 60));
  END IF;

  _total_eta_min := _avg_prep_min + _avg_delivery_min;

  -- Set estimated_delivery_at
  NEW.estimated_delivery_at := now() + (_total_eta_min || ' minutes')::interval;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_delivery_eta ON public.orders;
CREATE TRIGGER trg_compute_delivery_eta
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_delivery_eta();
