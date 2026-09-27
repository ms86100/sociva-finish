-- Instant orders with a product preparation time get that wait added to the
-- existing checkout travel ETA at place time. Scheduled and pre-order orders
-- are skipped. Orders with no prep time still use trg_compute_delivery_eta.

CREATE OR REPLACE FUNCTION public.checkout_travel_minutes(distance_km double precision)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN distance_km IS NULL OR distance_km < 0 THEN 5
    ELSE GREATEST(5, ceil((distance_km / 15.0) * 60.0)::integer + 3)
  END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_instant_order_prep_eta(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_prep integer := 0;
  v_seller_lat double precision;
  v_seller_lng double precision;
  v_distance double precision;
  v_travel integer;
  v_minutes integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.estimated_delivery_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_order.created_at IS NOT NULL AND v_order.created_at < now() - interval '10 minutes' THEN
    RETURN;
  END IF;

  IF v_order.order_type IS DISTINCT FROM 'purchase' THEN
    RETURN;
  END IF;

  IF v_order.scheduled_date IS NOT NULL
     OR v_order.scheduled_time_start IS NOT NULL
     OR v_order.scheduled_fulfillment_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND p.accepts_preorders IS TRUE
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(p.prep_time_minutes), 0)::integer
    INTO v_prep
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(NULLIF(btrim(p.action_type), ''), 'add_to_cart') = 'add_to_cart'
    AND p.prep_time_minutes IS NOT NULL
    AND p.prep_time_minutes > 0;

  IF COALESCE(v_prep, 0) <= 0 THEN
    RETURN;
  END IF;

  IF v_order.fulfillment_type IN ('pickup', 'self_pickup') THEN
    v_minutes := v_prep;
  ELSE
    SELECT
      CASE
        WHEN public.buyer_coordinates_are_valid(sp.latitude::double precision, sp.longitude::double precision)
          THEN sp.latitude::double precision
        ELSE s.latitude::double precision
      END,
      CASE
        WHEN public.buyer_coordinates_are_valid(sp.latitude::double precision, sp.longitude::double precision)
          THEN sp.longitude::double precision
        ELSE s.longitude::double precision
      END
    INTO v_seller_lat, v_seller_lng
    FROM public.seller_profiles sp
    LEFT JOIN public.societies s ON s.id = sp.society_id
    WHERE sp.id = v_order.seller_id;

    IF public.buyer_coordinates_are_valid(v_order.delivery_lat::double precision, v_order.delivery_lng::double precision)
       AND public.buyer_coordinates_are_valid(v_seller_lat, v_seller_lng) THEN
      v_distance := public.haversine_km(
        v_order.delivery_lat::numeric,
        v_order.delivery_lng::numeric,
        v_seller_lat::numeric,
        v_seller_lng::numeric
      )::double precision;
      v_travel := public.checkout_travel_minutes(v_distance);
      v_minutes := v_prep + COALESCE(v_travel, 0);
    ELSE
      v_minutes := v_prep;
    END IF;
  END IF;

  UPDATE public.orders
  SET estimated_delivery_at = now() + make_interval(mins => v_minutes)
  WHERE id = p_order_id
    AND estimated_delivery_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_stamp_instant_prep_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.stamp_instant_order_prep_eta(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_stamp_instant_prep_eta ON public.orders;
CREATE TRIGGER trg_orders_stamp_instant_prep_eta
AFTER UPDATE OF total_amount ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_orders_stamp_instant_prep_eta();

REVOKE ALL ON FUNCTION public.stamp_instant_order_prep_eta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_instant_order_prep_eta(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_orders_stamp_instant_prep_eta() TO service_role;
GRANT EXECUTE ON FUNCTION public.checkout_travel_minutes(double precision) TO service_role;
