-- Notification terminal lifecycle: mark related inbox rows read on terminal order
-- transitions, and ensure buyer_cancel_order sets app.acting_as for notify branches.

-- ── 1. Mark related unread notifications read when an order becomes terminal ──
CREATE OR REPLACE FUNCTION public.fn_mark_order_notifications_read_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _oid text := NEW.id::text;
  _terminal text[] := ARRAY[
    'cancelled', 'completed', 'delivered', 'rejected',
    'no_show', 'returned', 'failed'
  ];
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (NEW.status::text = ANY (_terminal)) THEN
    RETURN NEW;
  END IF;

  UPDATE public.user_notifications un
  SET is_read = true
  WHERE un.is_read = false
    AND (
      (un.data ->> 'order_id') = _oid
      OR (un.data ->> 'orderId') = _oid
      OR (un.data ->> 'entity_id') = _oid
      OR (un.payload ->> 'order_id') = _oid
      OR (un.payload ->> 'orderId') = _oid
      OR (un.payload ->> 'entity_id') = _oid
      OR coalesce(un.reference_path, '') LIKE '%/orders/' || _oid || '%'
      OR coalesce(un.action_url, '') LIKE '%/orders/' || _oid || '%'
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_order_notifications_read_on_terminal ON public.orders;
CREATE TRIGGER trg_mark_order_notifications_read_on_terminal
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_mark_order_notifications_read_on_terminal();

COMMENT ON FUNCTION public.fn_mark_order_notifications_read_on_terminal() IS
  'On terminal order status transitions, mark related unread user_notifications as read so inbox/banner clear without waiting for deferred client cleanup.';

-- ── 2. buyer_cancel_order: set app.acting_as = buyer (matches buyer_advance_order) ──
CREATE OR REPLACE FUNCTION public.buyer_cancel_order(
  _order_id uuid,
  _reason text DEFAULT NULL::text,
  _expected_status public.order_status DEFAULT NULL::public.order_status
) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _updated public.orders;
  _clean_reason text;
  _current_status text;
  _seller_group text;
  _order_type text;
  _fulfillment_type text;
  _delivery_handled_by text;
  _txn_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.status, sp.primary_group, o.order_type, o.fulfillment_type, o.delivery_handled_by
  INTO _current_status, _seller_group, _order_type, _fulfillment_type, _delivery_handled_by
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id AND o.buyer_id = auth.uid();

  IF _current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  IF _expected_status IS NOT NULL AND _current_status != _expected_status::text THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  IF _order_type = 'enquiry' THEN
    IF coalesce(_seller_group, 'default') IN ('classes', 'events') THEN
      _txn_type := 'book_slot';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF _order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF _fulfillment_type = 'self_pickup' THEN
    _txn_type := 'self_fulfillment';
  ELSIF _fulfillment_type = 'seller_delivery' THEN
    _txn_type := 'seller_delivery';
  ELSIF _fulfillment_type = 'delivery' AND coalesce(_delivery_handled_by, 'seller') = 'seller' THEN
    _txn_type := 'seller_delivery';
  ELSIF _fulfillment_type = 'delivery' AND _delivery_handled_by = 'platform' THEN
    _txn_type := 'cart_purchase';
  ELSE
    _txn_type := 'self_fulfillment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE from_status = _current_status
      AND to_status = 'cancelled'
      AND allowed_actor = 'buyer'
      AND parent_group = coalesce(_seller_group, 'default')
      AND transaction_type = _txn_type
  ) AND NOT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE from_status = _current_status
      AND to_status = 'cancelled'
      AND allowed_actor = 'buyer'
      AND parent_group = 'default'
      AND transaction_type = _txn_type
  ) THEN
    RAISE EXCEPTION 'Invalid status transition';
  END IF;

  _clean_reason := left(coalesce(nullif(btrim(_reason), ''), 'Cancelled by buyer'), 500);

  -- Required so order-status notify trigger uses buyer cancel copy/branch
  PERFORM set_config('app.acting_as', 'buyer', true);

  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Cancelled by buyer: ' || _clean_reason,
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = _order_id
    AND buyer_id = auth.uid()
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  RETURN _updated;
END;
$$;
