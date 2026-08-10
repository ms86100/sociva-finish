-- Add idempotency_key to notification_queue to prevent duplicate notifications
-- from multiple sources (DB trigger, Realtime, webhook, polling).
--
-- Key = md5(order_id || '-' || status_transition || '-' || recipient_user_id)
-- A unique partial index on (user_id, idempotency_key) ensures the same
-- logical order event can only ever produce one queue row per recipient.

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_idempotency
  ON public.notification_queue (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Update the new-order notification trigger to supply idempotency_key.
-- This prevents the same order state-transition from creating duplicate
-- queue rows when the trigger fires multiple times (e.g. race with Realtime).

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name     text;
  _is_auto_accepted boolean;
  _seller_title   text;
  _seller_body    text;
  _notify_status  text;
  _notify_amount  numeric;
  _idem_key       text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'payment_pending' THEN RETURN NEW; END IF;
    _notify_status := NEW.status;
    _notify_amount := NEW.total_amount;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'payment_pending' THEN RETURN NEW; END IF;
    IF NEW.status NOT IN ('placed', 'preparing') THEN RETURN NEW; END IF;
    _notify_status := NEW.status;
    _notify_amount := NEW.total_amount;
  ELSE
    RETURN NEW;
  END IF;

  -- Idempotency key: one notification per (order, status_transition, recipient).
  -- md5 is fine here — not a security context, just dedup.
  _idem_key := md5(NEW.id::text || '-new_order-' || _notify_status);

  _is_auto_accepted := (_notify_status = 'preparing');

  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  SELECT name     INTO _buyer_name    FROM profiles         WHERE id = NEW.buyer_id;

  IF _seller_user_id IS NOT NULL THEN
    IF _is_auto_accepted THEN
      _seller_title := '✅ Order Auto-Accepted';
      IF _notify_amount > 0 THEN
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || _notify_amount || '. Auto-accepted — start preparing!';
      ELSE
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed a new order. Auto-accepted — start preparing!';
      END IF;
    ELSE
      _seller_title := '🔔 New Order Received';
      IF _notify_amount > 0 THEN
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || _notify_amount || '. Tap to accept!';
      ELSE
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed a new order. Tap to accept!';
      END IF;
    END IF;

    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload, idempotency_key)
    VALUES (
      _seller_user_id,
      _seller_title,
      _seller_body,
      'order',
      '/seller/orders/' || NEW.id,
      jsonb_build_object(
        'order_id', NEW.id,
        'orderId', NEW.id,
        'buyer_name', _buyer_name,
        'total', _notify_amount,
        'type', NEW.order_type,
        'auto_accepted', _is_auto_accepted,
        'target_role', 'seller',
        'status', _notify_status,
        'action', 'view_order',
        'reference_path', '/orders/' || NEW.id
      ),
      _idem_key
    )
    ON CONFLICT ON CONSTRAINT idx_notification_queue_idempotency DO NOTHING;  -- idempotent: ignore duplicates
  END IF;

  RETURN NEW;
END;
$function$;
