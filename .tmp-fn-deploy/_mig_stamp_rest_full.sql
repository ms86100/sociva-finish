-- Backfill in-flight / historical mis-stamps (row value is SSoT for UI + triggers)
UPDATE public.orders o
SET transaction_type = public.heal_order_transaction_type(
      o.transaction_type,
      o.fulfillment_type,
      o.delivery_handled_by
    ),
    updated_at = now()
WHERE o.order_type = 'purchase'
  AND o.transaction_type IS DISTINCT FROM public.heal_order_transaction_type(
        o.transaction_type,
        o.fulfillment_type,
        o.delivery_handled_by
      );

-- seller_advance_order: heal stamp before transition check; persist healed stamp
CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
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
  v_healed TEXT;
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

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := public.heal_order_transaction_type(
      v_order.transaction_type,
      v_order.fulfillment_type,
      v_order.delivery_handled_by
    );
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery')
         AND COALESCE(v_order.delivery_handled_by, 'seller') = 'seller' THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
      v_transaction_type := 'cart_purchase';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  v_healed := v_transaction_type;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      transaction_type = COALESCE(v_healed, transaction_type),
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN _new_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_advance_order(uuid, order_status, text) TO authenticated, service_role;

-- buyer_advance_order: same heal
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

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := public.heal_order_transaction_type(
      v_order.transaction_type,
      v_order.fulfillment_type,
      v_order.delivery_handled_by
    );
  ELSE
    SELECT cc.transaction_type INTO v_listing_type
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN category_config cc ON cc.category::text = p.category
    WHERE oi.order_id = _order_id
    LIMIT 1;

    IF v_listing_type = 'contact_only' THEN
      v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning', 'events') THEN
        v_transaction_type := 'service_booking';
      ELSE
        v_transaction_type := 'request_service';
      END IF;
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
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buyer_advance_order(uuid, order_status) TO authenticated, service_role;

-- validate_order_status_transition: heal before EXISTS check; honor acting_as when set
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

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := public.heal_order_transaction_type(
      NEW.transaction_type,
      NEW.fulfillment_type,
      NEW.delivery_handled_by
    );
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN
      _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
      _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

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


-- Patch create_multi_vendor_orders stamp: fulfillment-aware (not always cart_purchase)
DO $do$
DECLARE
  def text;
  old_block text;
  new_block text;
  norm text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
    AND pg_get_function_identity_arguments(p.oid) LIKE '%_loyalty_points%'
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders overload not found';
  END IF;

  norm := replace(def, E'\r\n', E'\n');

  old_block := $b$
    SELECT atm.transaction_type INTO _resolved_tx_type
    FROM public.action_type_workflow_map atm
    WHERE atm.action_type = 'add_to_cart'
    LIMIT 1;
$b$;

  new_block := $b$
    -- Fulfillment-aware workflow stamp (seller delivery / pickup / platform)
    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );
$b$;

  IF position(trim(both E'\n' from old_block) in norm) = 0 THEN
    RAISE EXCEPTION 'Stamp block not found in create_multi_vendor_orders';
  END IF;

  norm := replace(norm, trim(both E'\n' from old_block), trim(both E'\n' from new_block));

  IF position('resolve_cart_order_transaction_type' in norm) = 0 THEN
    RAISE EXCEPTION 'Failed to patch create_multi_vendor_orders stamp block';
  END IF;

  EXECUTE norm;
END;
$do$;
