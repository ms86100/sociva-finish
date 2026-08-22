-- P0: seller new-order push never enqueued.
-- Root cause: CONSTRAINT TRIGGER trg_enqueue_new_order_notification_insert (DEFERRABLE)
-- is not attached to a table constraint, so it never fires on INSERT.
-- Fix: enqueue after order_items insert (items + totals exist) and keep payment_pending → placed UPDATE path.

CREATE OR REPLACE FUNCTION public.enqueue_seller_new_order_notification(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
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
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.status IN ('payment_pending', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT sp.user_id, sp.business_name INTO v_seller_user_id, v_seller_business_name
  FROM public.seller_profiles sp WHERE sp.id = v_order.seller_id;

  IF v_seller_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.name, p.flat_number INTO v_buyer_name, v_buyer_flat_no
  FROM public.profiles p WHERE p.id = v_order.buyer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'total_price', oi.quantity * oi.unit_price
  )) INTO v_order_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = v_order.id;

  IF v_order_items IS NULL THEN
    v_order_items := '[]'::jsonb;
  END IF;

  v_item_line := public.seller_order_item_summary(v_order.id);
  v_location := public.seller_order_buyer_location_summary(
    v_order.seller_id,
    v_order.buyer_id,
    v_order.delivery_address,
    v_order.delivery_lat,
    v_order.delivery_lng,
    v_order.society_id
  );
  v_amount := v_order.total_amount;
  v_idem_key := md5(v_order.id::text || '-new_order-' || v_order.status::text);

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
    '/orders/' || v_order.id::text,
    jsonb_build_object(
      'orderId', v_order.id::text,
      'order_id', v_order.id::text,
      'status', v_order.status::text,
      'type', 'order',
      'target_role', 'seller',
      'wa_template', 'sociva_new_order_seller',
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
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        payload = EXCLUDED.payload,
        status = CASE
          WHEN notification_queue.status IN ('processed', 'failed') THEN 'pending'
          ELSE notification_queue.status
        END,
        push_skip_reason = NULL,
        processed_at = NULL,
        updated_at = now();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_seller_new_order_notification failed for order %: %', p_order_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'payment_pending' AND NEW.status IN ('placed', 'preparing')) THEN
      RETURN NEW;
    END IF;
    PERFORM public.enqueue_seller_new_order_notification(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_new_order_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_on_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NULL OR v_status IN ('payment_pending', 'cancelled') THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_seller_new_order_notification(NEW.order_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_new_order_on_item failed for order %: %', NEW.order_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification_insert ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_new_order_on_item ON public.order_items;

CREATE TRIGGER trg_enqueue_new_order_notification
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_new_order_notification();

CREATE TRIGGER trg_enqueue_new_order_on_item
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_new_order_on_item();
