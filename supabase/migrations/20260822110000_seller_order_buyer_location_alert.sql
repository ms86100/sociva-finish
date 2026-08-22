-- Show the buyer locality and distance on seller new-order pushes
-- so the seller can reject an order that is not in their community.

CREATE OR REPLACE FUNCTION public.seller_order_buyer_location_summary(
  p_seller_id uuid,
  p_buyer_id uuid,
  p_delivery_address text,
  p_delivery_lat double precision,
  p_delivery_lng double precision,
  p_order_society_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society text;
  v_phase text;
  v_addr text;
  v_dist numeric;
  v_radius numeric;
  v_seller_lat double precision;
  v_seller_lng double precision;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  SELECT s.name INTO v_society
  FROM public.societies s
  WHERE s.id = COALESCE(
    p_order_society_id,
    (SELECT pr.society_id FROM public.profiles pr WHERE pr.id = p_buyer_id)
  );

  SELECT NULLIF(btrim(pr.phase), '') INTO v_phase
  FROM public.profiles pr
  WHERE pr.id = p_buyer_id;

  IF v_phase IS NOT NULL AND v_phase !~* '(phase|ph[[:space:]]|tower|block|wing)' THEN
    v_phase := 'Phase ' || v_phase;
  END IF;

  v_addr := NULLIF(btrim(COALESCE(p_delivery_address, '')), '');

  SELECT sp.latitude, sp.longitude, sp.delivery_radius_km
  INTO v_seller_lat, v_seller_lng, v_radius
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;

  IF public.buyer_coordinates_are_valid(p_delivery_lat, p_delivery_lng)
     AND public.buyer_coordinates_are_valid(v_seller_lat, v_seller_lng) THEN
    v_dist := round(public.haversine_km(
      p_delivery_lat, p_delivery_lng, v_seller_lat, v_seller_lng
    )::numeric, 1);
  END IF;

  IF v_society IS NOT NULL THEN
    v_parts := v_parts || v_society;
  END IF;
  IF v_phase IS NOT NULL THEN
    v_parts := v_parts || v_phase;
  END IF;
  IF v_society IS NULL AND v_addr IS NOT NULL THEN
    v_parts := v_parts || left(v_addr, 60);
  END IF;
  IF v_dist IS NOT NULL THEN
    v_parts := v_parts || (trim(to_char(v_dist, 'FM999990.0')) || ' km away');
    IF v_radius IS NOT NULL AND v_dist > v_radius THEN
      v_parts := v_parts || ('outside your ' || trim(to_char(v_radius, 'FM999990.0')) || ' km radius');
    END IF;
  END IF;

  IF coalesce(array_length(v_parts, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN array_to_string(v_parts, ' · ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.seller_order_buyer_location_summary(
  uuid, uuid, text, double precision, double precision, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_user_id uuid;
  v_seller_business_name text;
  v_buyer_name text;
  v_buyer_flat_no text;
  v_order_items jsonb;
  v_location text;
  v_amount numeric;
  v_title text;
  v_body text;
  v_idem_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('payment_pending', 'cancelled') THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'payment_pending' AND NEW.status IN ('placed', 'preparing')) THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  SELECT sp.user_id, sp.business_name INTO v_seller_user_id, v_seller_business_name
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF v_seller_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.name, p.flat_number INTO v_buyer_name, v_buyer_flat_no
  FROM public.profiles p WHERE p.id = NEW.buyer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'total_price', oi.quantity * oi.unit_price
  )) INTO v_order_items
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.id;

  IF v_order_items IS NULL THEN
    v_order_items := '[]'::jsonb;
  END IF;

  v_location := public.seller_order_buyer_location_summary(
    NEW.seller_id,
    NEW.buyer_id,
    NEW.delivery_address,
    NEW.delivery_lat,
    NEW.delivery_lng,
    NEW.society_id
  );
  v_amount := NEW.total_amount;
  v_idem_key := md5(NEW.id::text || '-new_order-' || NEW.status);

  v_title := 'New order received';
  v_body := COALESCE(v_buyer_name, 'Customer');
  IF COALESCE(v_amount, 0) > 0 THEN
    v_body := v_body || ' · Rs ' || trim(to_char(v_amount, 'FM9999990'));
  END IF;
  IF v_location IS NOT NULL THEN
    v_body := v_body || ' · ' || v_location;
  END IF;
  v_body := v_body || '. Tap to review and accept.';

  INSERT INTO public.notification_queue (
    user_id, type, title, body, reference_path, payload, idempotency_key
  )
  VALUES (
    v_seller_user_id,
    'order',
    v_title,
    left(v_body, 220),
    '/orders/' || NEW.id::text,
    jsonb_build_object(
      'orderId', NEW.id::text,
      'status', NEW.status::text,
      'type', 'order',
      'buyer_name', COALESCE(v_buyer_name, 'Customer'),
      'seller_business_name', COALESCE(v_seller_business_name, 'Store'),
      'seller_flat_number', COALESCE(v_buyer_flat_no, ''),
      'buyer_location', v_location,
      'items', v_order_items,
      'item_count', COALESCE(jsonb_array_length(v_order_items), 0)
    ),
    v_idem_key
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_new_order_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
