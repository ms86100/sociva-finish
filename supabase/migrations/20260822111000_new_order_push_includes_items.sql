-- New-order push must show what was ordered, then location.

CREATE OR REPLACE FUNCTION public.seller_order_item_summary(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH named AS (
    SELECT
      COALESCE(NULLIF(btrim(p.name), ''), 'Item') AS product_name,
      GREATEST(oi.quantity, 1) AS qty
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    ORDER BY p.name
    LIMIT 3
  ),
  counted AS (
    SELECT count(*) AS total
    FROM public.order_items
    WHERE order_id = p_order_id
  )
  SELECT CASE
    WHEN (SELECT total FROM counted) = 0 THEN NULL
    ELSE trim(both ' ' FROM concat_ws(
      '',
      (SELECT string_agg(qty::text || 'x ' || product_name, ', ') FROM named),
      CASE
        WHEN (SELECT total FROM counted) > 3
          THEN ' +' || ((SELECT total FROM counted) - 3)::text || ' more'
        ELSE ''
      END
    ))
  END;
$$;

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
  v_item_line text;
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

  v_item_line := public.seller_order_item_summary(NEW.id);
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

  v_title := CASE
    WHEN v_item_line IS NOT NULL THEN left('New order: ' || v_item_line, 65)
    ELSE 'New order received'
  END;

  v_body := COALESCE(v_item_line, 'New order');
  IF COALESCE(v_amount, 0) > 0 THEN
    v_body := v_body || ' · Rs ' || trim(to_char(v_amount, 'FM9999990'));
  END IF;
  v_body := v_body || ' · ' || COALESCE(v_buyer_name, 'Customer');
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
    left(v_body, 240),
    '/orders/' || NEW.id::text,
    jsonb_build_object(
      'orderId', NEW.id::text,
      'status', NEW.status::text,
      'type', 'order',
      'buyer_name', COALESCE(v_buyer_name, 'Customer'),
      'seller_business_name', COALESCE(v_seller_business_name, 'Store'),
      'seller_flat_number', COALESCE(v_buyer_flat_no, ''),
      'buyer_location', v_location,
      'item_summary', v_item_line,
      'items', v_order_items,
      'item_count', COALESCE(jsonb_array_length(v_order_items), 0)
    ),
    v_idem_key
  )
  ON CONFLICT (user_id, idempotency_key) DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        payload = EXCLUDED.payload;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_new_order_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification_insert ON public.orders;

CREATE TRIGGER trg_enqueue_new_order_notification
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_new_order_notification();

CREATE CONSTRAINT TRIGGER trg_enqueue_new_order_notification_insert
AFTER INSERT ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_new_order_notification();
