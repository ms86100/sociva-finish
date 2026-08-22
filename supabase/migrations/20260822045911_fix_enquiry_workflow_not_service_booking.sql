-- Enquiry is request_service (or contact_enquiry), never service_booking / book_slot.
-- Aligns seller_advance, buyer_advance, buyer_cancel, status trigger, and get_allowed_transitions.

CREATE OR REPLACE FUNCTION public.resolve_enquiry_transaction_type(p_listing_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_listing_type IN ('contact_only', 'contact_enquiry') THEN 'contact_enquiry'
    ELSE 'request_service'
  END;
$$;

CREATE OR REPLACE FUNCTION public.heal_enquiry_transaction_type(
  p_order_type text,
  p_listing_type text,
  p_resolved_txn text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_order_type IS DISTINCT FROM 'enquiry' THEN p_resolved_txn
    WHEN p_resolved_txn IS NULL OR p_resolved_txn IN ('service_booking', 'book_slot')
      THEN public.resolve_enquiry_transaction_type(p_listing_type)
    ELSE p_resolved_txn
  END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_enquiry_transaction_type(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heal_enquiry_transaction_type(text, text, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- seller_advance_order
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.seller_advance_order(uuid, order_status, text);

CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
  v_updated_id uuid;
  v_final_status order_status;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  SELECT p.listing_type INTO v_listing_type
  FROM order_items oi JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id LIMIT 1;

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := public.heal_order_transaction_type(
      v_order.transaction_type,
      v_order.fulfillment_type,
      v_order.delivery_handled_by
    );
  ELSE
    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      v_transaction_type := public.resolve_enquiry_transaction_type(v_listing_type);
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery')
         AND COALESCE(v_order.delivery_handled_by, 'seller') = 'seller' THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
      v_transaction_type := 'cart_purchase';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  v_transaction_type := public.heal_enquiry_transaction_type(
    v_order.order_type, v_listing_type, v_transaction_type
  );

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to % (workflow %)',
      v_order.status, _new_status, v_transaction_type;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      transaction_type = COALESCE(v_transaction_type, transaction_type),
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN _new_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_advance_order(uuid, order_status, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- buyer_advance_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_advance_order(
  _order_id uuid,
  _new_status order_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
BEGIN
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  SELECT p.listing_type INTO v_listing_type
  FROM order_items oi JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := public.heal_order_transaction_type(
      v_order.transaction_type,
      v_order.fulfillment_type,
      v_order.delivery_handled_by
    );
  ELSE
    IF v_listing_type = 'contact_only' THEN
      v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      v_transaction_type := public.resolve_enquiry_transaction_type(v_listing_type);
    ELSIF v_order.order_type = 'booking' THEN
      v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN
      v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type = 'seller_delivery' THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery'
         AND (v_order.delivery_handled_by IS NULL OR v_order.delivery_handled_by = 'seller') THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
      v_transaction_type := 'cart_purchase';
    ELSE
      v_transaction_type := 'self_fulfillment';
    END IF;
  END IF;

  v_transaction_type := public.heal_enquiry_transaction_type(
    v_order.order_type, v_listing_type, v_transaction_type
  );

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'buyer', true);

  IF _new_status::text = 'completed' AND v_order.payment_type = 'cod' AND COALESCE(v_order.payment_status, 'pending') <> 'paid' THEN
    UPDATE orders
    SET status = _new_status,
        transaction_type = COALESCE(v_transaction_type, transaction_type),
        payment_status = 'paid',
        payment_confirmed_at = now(),
        buyer_confirmed_at = now(),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  ELSE
    UPDATE orders
    SET status = _new_status,
        transaction_type = COALESCE(v_transaction_type, transaction_type),
        buyer_confirmed_at = CASE WHEN _new_status::text = 'completed' THEN now() ELSE buyer_confirmed_at END,
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buyer_advance_order(uuid, order_status) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- buyer_cancel_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_cancel_order(
  _order_id uuid,
  _reason text DEFAULT NULL::text,
  _expected_status order_status DEFAULT NULL::order_status
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _updated public.orders;
  _clean_reason text;
  _current_status text;
  _seller_group text;
  _order_type text;
  _fulfillment_type text;
  _delivery_handled_by text;
  _txn_type text;
  _listing_type text;
  _payment_status text;
  _v_refund_amount numeric;
  _v_dest text := 'original_payment';
  _v_payment_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.status, sp.primary_group, o.order_type, o.fulfillment_type, o.delivery_handled_by,
         o.payment_status
  INTO _current_status, _seller_group, _order_type, _fulfillment_type, _delivery_handled_by,
       _payment_status
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id AND o.buyer_id = auth.uid();

  IF _current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  IF _expected_status IS NOT NULL AND _current_status != _expected_status::text THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  SELECT p.listing_type INTO _listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF _order_type = 'enquiry' THEN
    _txn_type := public.resolve_enquiry_transaction_type(_listing_type);
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

  _txn_type := public.heal_enquiry_transaction_type(_order_type, _listing_type, _txn_type);

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

  PERFORM set_config('app.acting_as', 'buyer', true);

  UPDATE public.orders
  SET
    status = 'cancelled',
    transaction_type = COALESCE(_txn_type, transaction_type),
    rejection_reason = 'Cancelled by buyer: ' || _clean_reason,
    failure_owner = COALESCE(failure_owner, 'buyer'),
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = _order_id
    AND buyer_id = auth.uid()
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  -- Paid pre-accept (placed) buyer cancel → auto approved refund (mirror seller-cancel)
  IF _current_status = 'placed'
     AND _payment_status IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM public.refund_requests rr
       WHERE rr.order_id = _order_id
         AND rr.status NOT IN ('rejected')
         AND COALESCE(rr.refund_state, '') NOT IN ('rejected')
     ) THEN
    _v_refund_amount := public.compute_child_gateway_refund_amount(_order_id);
    IF _v_refund_amount IS NOT NULL AND _v_refund_amount > 0 THEN
      _v_payment_id := NULLIF(_updated.razorpay_payment_id, '');
      IF _v_payment_id IS NULL AND _updated.checkout_group_id IS NOT NULL THEN
        SELECT NULLIF(cg.razorpay_payment_id, '') INTO _v_payment_id
        FROM public.checkout_groups cg
        WHERE cg.id = _updated.checkout_group_id;
      END IF;
      IF _v_payment_id IS NULL THEN
        _v_dest := 'wallet';
      END IF;

      INSERT INTO public.refund_requests (
        order_id, buyer_id, seller_id, society_id, amount, reason, category,
        status, refund_state, auto_approved, approved_at, refund_destination,
        wallet_credit_amount
      ) VALUES (
        _updated.id,
        _updated.buyer_id,
        _updated.seller_id,
        _updated.society_id,
        _v_refund_amount,
        'Buyer cancelled before seller acceptance',
        'buyer_cancelled',
        'approved',
        'approved',
        true,
        now(),
        _v_dest,
        CASE WHEN _v_dest = 'wallet' THEN _v_refund_amount ELSE 0 END
      );

      UPDATE public.orders
      SET payment_status = 'refund_initiated', updated_at = now()
      WHERE id = _updated.id;

      SELECT * INTO _updated FROM public.orders WHERE id = _order_id;
    END IF;
  END IF;

  RETURN _updated;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buyer_cancel_order(uuid, text, order_status) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- validate_order_status_transition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
  _acting_as TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  SELECT p.listing_type INTO _listing_type
  FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.id LIMIT 1;

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := public.heal_order_transaction_type(
      NEW.transaction_type,
      NEW.fulfillment_type,
      NEW.delivery_handled_by
    );
  ELSE
    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      _txn_type := public.resolve_enquiry_transaction_type(_listing_type);
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN
      _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
      _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  _txn_type := public.heal_enquiry_transaction_type(NEW.order_type, _listing_type, _txn_type);

  -- Persist healed stamp on the row being updated
  NEW.transaction_type := _txn_type;

  _acting_as := nullif(current_setting('app.acting_as', true), '');

  IF _acting_as IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
        AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
          AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
      ) INTO _valid;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
      ) INTO _valid;
    END IF;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%, actor=%)',
      OLD.status, NEW.status, _parent_group, _txn_type, COALESCE(_acting_as, 'any');
  END IF;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------------
-- get_allowed_transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_allowed_transitions(_order_id uuid, _actor text DEFAULT 'seller'::text)
RETURNS TABLE(status_key text, sort_order integer, actor text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current_status text;
  _parent_group text;
  _transaction_type text;
  _listing_type text;
  _order record;
BEGIN
  SELECT o.*, sp.primary_group
  INTO _order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF _order IS NULL THEN RETURN; END IF;

  _parent_group := resolve_transition_parent_group(_order.primary_group);
  _current_status := _order.status::text;

  SELECT p.listing_type INTO _listing_type
  FROM order_items oi JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id LIMIT 1;

  IF _order.transaction_type IS NOT NULL THEN
    _transaction_type := public.heal_order_transaction_type(
      _order.transaction_type,
      _order.fulfillment_type,
      _order.delivery_handled_by
    );
  ELSE
    IF _order.order_type = 'enquiry' THEN
      _transaction_type := public.resolve_enquiry_transaction_type(_listing_type);
    ELSIF _order.order_type = 'booking' THEN _transaction_type := 'service_booking';
    ELSIF _order.fulfillment_type = 'self_pickup' THEN _transaction_type := 'self_fulfillment';
    ELSIF _order.fulfillment_type IN ('delivery','seller_delivery') AND COALESCE(_order.delivery_handled_by,'seller') = 'seller' THEN _transaction_type := 'seller_delivery';
    ELSIF _order.fulfillment_type = 'delivery' AND _order.delivery_handled_by = 'platform' THEN _transaction_type := 'cart_purchase';
    ELSE _transaction_type := 'self_fulfillment'; END IF;
  END IF;

  _transaction_type := public.heal_enquiry_transaction_type(
    _order.order_type, _listing_type, _transaction_type
  );

  RETURN QUERY
  SELECT cst.to_status, csf.sort_order, cst.allowed_actor
  FROM category_status_transitions cst
  LEFT JOIN category_status_flows csf
    ON csf.status_key = cst.to_status
    AND csf.transaction_type = _transaction_type
    AND csf.parent_group = _parent_group
  WHERE cst.from_status = _current_status
    AND cst.allowed_actor = _actor
    AND cst.transaction_type = _transaction_type
    AND (cst.parent_group = _parent_group OR cst.parent_group = 'default')
  ORDER BY CASE WHEN cst.parent_group = _parent_group THEN 0 ELSE 1 END, csf.sort_order;
END;
$function$;


-- Backfill existing enquiry rows that were left unstamped or mis-stamped as booking.
UPDATE public.orders o
SET transaction_type = public.resolve_enquiry_transaction_type(
  (
    SELECT p.listing_type
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = o.id
    LIMIT 1
  )
)
WHERE o.order_type = 'enquiry'
  AND (o.transaction_type IS NULL OR o.transaction_type IN ('service_booking', 'book_slot'));
