-- ============================================================
-- Phase 0 HARDENED — refunds SM, buyer cancel auto-refund, RPC-only,
-- OAE vault wake, complete_refund_by_gateway_id
-- ============================================================

-- ------------------------------------------------------------
-- 1) Refund state machine: INTO and OUT OF needs_manual_review
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_refund_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF NEW.refund_state IS NOT DISTINCT FROM OLD.refund_state THEN
    RETURN NEW;
  END IF;

  -- Fail-closed allowlist including needs_manual_review in/out
  ok := (OLD.refund_state, NEW.refund_state) IN (
    ('requested','approved'),
    ('requested','rejected'),
    ('approved','refund_initiated'),
    ('refund_initiated','refund_processing'),
    ('refund_initiated','refund_completed'),
    ('refund_initiated','refund_failed'),
    ('refund_initiated','needs_manual_review'),
    ('refund_processing','refund_completed'),
    ('refund_processing','refund_failed'),
    ('refund_processing','needs_manual_review'),
    ('refund_failed','refund_initiated'),
    ('refund_failed','needs_manual_review'),
    ('needs_manual_review','refund_initiated'),
    ('needs_manual_review','refund_processing'),
    ('needs_manual_review','refund_completed'),
    ('needs_manual_review','refund_failed'),
    ('needs_manual_review','rejected')
  );

  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid refund_state transition: % -> %', OLD.refund_state, NEW.refund_state
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_state_check;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_state_check CHECK (refund_state IN (
    'requested','approved','rejected',
    'refund_initiated','refund_processing',
    'refund_completed','refund_failed',
    'needs_manual_review'
  ));

-- ------------------------------------------------------------
-- 2) Drop client INSERT/UPDATE on refund_requests (RPC-only)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Buyers can create refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Buyers can insert refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Users can create refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Authenticated can insert refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Sellers can update refunds for their orders" ON public.refund_requests;
DROP POLICY IF EXISTS "Buyers can update their refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Users can update refund requests" ON public.refund_requests;

-- Keep SELECT policies for buyer/seller visibility; mutations via SECURITY DEFINER RPCs only.
COMMENT ON TABLE public.refund_requests IS
  'Refund ledger. Client INSERT/UPDATE revoked (Phase 0) — use request_refund / approve RPCs / service_role.';

-- ------------------------------------------------------------
-- 3) Paid buyer cancel pre-accept → auto-create approved refund
-- ------------------------------------------------------------
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

  PERFORM set_config('app.acting_as', 'buyer', true);

  UPDATE public.orders
  SET
    status = 'cancelled',
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

-- ------------------------------------------------------------
-- 4) complete_refund_by_gateway_id — webhook reconcile (no raw payment_status)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_refund_by_gateway_id(
  p_gateway_refund_id text,
  p_gateway_status text DEFAULT 'processed',
  p_razorpay_payment_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.refund_requests;
  v_completed public.refund_requests;
BEGIN
  IF p_gateway_refund_id IS NULL OR length(trim(p_gateway_refund_id)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_gateway_refund_id');
  END IF;

  -- Idempotent: already completed with this gateway id
  SELECT * INTO r
  FROM public.refund_requests
  WHERE gateway_refund_id = p_gateway_refund_id
  LIMIT 1;

  IF FOUND AND r.refund_state = 'refund_completed' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'refund_id', r.id);
  END IF;

  IF NOT FOUND AND p_razorpay_payment_id IS NOT NULL THEN
    -- Match open refund on order(s) sharing this razorpay payment
    SELECT rr.* INTO r
    FROM public.refund_requests rr
    JOIN public.orders o ON o.id = rr.order_id
    WHERE rr.refund_state IN ('approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
      AND (
        o.razorpay_payment_id = p_razorpay_payment_id
        OR EXISTS (
          SELECT 1 FROM public.checkout_groups cg
          WHERE cg.id = o.checkout_group_id
            AND cg.razorpay_payment_id = p_razorpay_payment_id
        )
      )
    ORDER BY rr.created_at ASC
    LIMIT 1
    FOR UPDATE OF rr;
  ELSIF FOUND THEN
    SELECT * INTO r FROM public.refund_requests WHERE id = r.id FOR UPDATE;
  END IF;

  IF r.id IS NULL THEN
    -- No matching refund_request — do NOT mutate orders.payment_status.
    -- Escalate for ops; webhook should not invent refunded state.
    INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
    VALUES (
      'refund_webhook_unmatched',
      NULL,
      'razorpay_refund',
      p_gateway_refund_id,
      jsonb_build_object(
        'gateway_status', p_gateway_status,
        'razorpay_payment_id', p_razorpay_payment_id
      )
    );
    RETURN jsonb_build_object('ok', true, 'matched', false, 'logged', true);
  END IF;

  IF r.refund_state = 'approved' THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        gateway_refund_id = p_gateway_refund_id,
        gateway_status = p_gateway_status,
        updated_at = now()
    WHERE id = r.id;
  ELSIF r.refund_state = 'needs_manual_review' THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        gateway_refund_id = COALESCE(gateway_refund_id, p_gateway_refund_id),
        gateway_status = p_gateway_status,
        updated_at = now()
    WHERE id = r.id;
  ELSE
    UPDATE public.refund_requests
    SET gateway_refund_id = COALESCE(gateway_refund_id, p_gateway_refund_id),
        gateway_status = p_gateway_status,
        updated_at = now()
    WHERE id = r.id;
  END IF;

  v_completed := public.complete_refund(r.id, p_gateway_refund_id, p_gateway_status);

  RETURN jsonb_build_object(
    'ok', true,
    'matched', true,
    'refund_id', v_completed.id,
    'refund_state', v_completed.refund_state
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_refund_by_gateway_id(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_refund_by_gateway_id(text, text, text) TO service_role;

-- ------------------------------------------------------------
-- 5) OAE wake: Vault service_role_key (like PNQ) — never hardcoded anon JWT
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_order_acceptance_expiry(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order record;
  v_timeout int := public._order_acceptance_timeout_seconds();
  v_fire_at timestamptz;
  v_job text := public._order_acceptance_cron_name(_order_id);
  v_cron_at timestamptz;
  v_schedule text;
  v_url text;
  v_service_key text;
BEGIN
  SELECT id, status, auto_accepted, auto_cancel_at
  INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('scheduled', false, 'reason', 'not_found');
  END IF;

  IF v_order.status IS DISTINCT FROM 'placed'::public.order_status
     OR COALESCE(v_order.auto_accepted, false) = true THEN
    PERFORM public.clear_order_acceptance_expiry(_order_id);
    RETURN jsonb_build_object('scheduled', false, 'reason', 'not_placed');
  END IF;

  IF v_order.auto_cancel_at IS NOT NULL AND v_order.auto_cancel_at > now() THEN
    v_fire_at := v_order.auto_cancel_at;
  ELSE
    v_fire_at := now() + make_interval(secs => v_timeout);
  END IF;

  -- acting_as so status stamp passes fail-closed gate if needed
  PERFORM set_config('app.acting_as', 'system', true);

  UPDATE public.orders
  SET auto_cancel_at = v_fire_at,
      updated_at = now()
  WHERE id = _order_id
    AND status = 'placed'::public.order_status;

  PERFORM public.clear_order_acceptance_expiry(_order_id);

  v_cron_at := date_trunc('minute', v_fire_at) + interval '1 minute';
  v_schedule := to_char(v_cron_at AT TIME ZONE 'UTC', 'MI HH24 DD MM *');

  BEGIN
    PERFORM cron.schedule(
      v_job,
      v_schedule,
      format(
        $cmd$SELECT public.expire_unaccepted_order(%L::uuid);$cmd$,
        _order_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM cron.unschedule(v_job);
      PERFORM cron.schedule(
        v_job,
        v_schedule,
        format(
          $cmd$SELECT public.expire_unaccepted_order(%L::uuid);$cmd$,
          _order_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'schedule_order_acceptance_expiry cron failed for %: %', _order_id, SQLERRM;
    END;
  END;

  INSERT INTO public.order_acceptance_expiry (order_id, fire_at, cron_job_name)
  VALUES (_order_id, v_fire_at, v_job)
  ON CONFLICT (order_id) DO UPDATE
  SET fire_at = EXCLUDED.fire_at,
      cron_job_name = EXCLUDED.cron_job_name,
      created_at = now();

  v_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ) || '/functions/v1/expire-unaccepted-order';

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    v_service_key := current_setting('app.settings.service_role_key', true);
  END IF;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    RAISE WARNING 'schedule_order_acceptance_expiry: service_role key missing — cron-only fallback for %', _order_id;
  ELSE
    BEGIN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'order_id', _order_id,
          'trigger', 'acceptance_schedule',
          'time', now()
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'schedule_order_acceptance_expiry edge invoke failed for %: %', _order_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'scheduled', true,
    'order_id', _order_id,
    'fire_at', v_fire_at,
    'cron_job_name', v_job,
    'auth', 'vault_service_role'
  );
END;
$$;

-- expire_unaccepted_order already sets acting_as=system; reinforce comment
COMMENT ON FUNCTION public.expire_unaccepted_order(uuid) IS
  'O(1) acceptance timeout cancel. Sets app.acting_as=system for fail-closed status gate. service_role only.';

-- Ensure default category_status_flows for common txn types (idempotent seed)
INSERT INTO public.category_status_flows
  (parent_group, transaction_type, status_key, sort_order, actor, is_terminal, is_success, display_label)
SELECT v.parent_group, v.transaction_type, v.status_key, v.sort_order, v.actor, v.is_terminal, v.is_success, v.display_label
FROM (VALUES
  ('default','cart_purchase','placed',10,'buyer',false,false,'Placed'),
  ('default','cart_purchase','preparing',20,'seller',false,false,'Preparing'),
  ('default','cart_purchase','out_for_delivery',30,'seller',false,false,'Out for delivery'),
  ('default','cart_purchase','delivered',40,'seller',true,true,'Delivered'),
  ('default','cart_purchase','cancelled',90,'buyer',true,false,'Cancelled'),
  ('default','self_fulfillment','placed',10,'buyer',false,false,'Placed'),
  ('default','self_fulfillment','preparing',20,'seller',false,false,'Preparing'),
  ('default','self_fulfillment','ready_for_pickup',30,'seller',false,false,'Ready'),
  ('default','self_fulfillment','completed',40,'seller',true,true,'Completed'),
  ('default','self_fulfillment','cancelled',90,'buyer',true,false,'Cancelled'),
  ('default','seller_delivery','placed',10,'buyer',false,false,'Placed'),
  ('default','seller_delivery','preparing',20,'seller',false,false,'Preparing'),
  ('default','seller_delivery','out_for_delivery',30,'seller',false,false,'Out for delivery'),
  ('default','seller_delivery','delivered',40,'seller',true,true,'Delivered'),
  ('default','seller_delivery','cancelled',90,'buyer',true,false,'Cancelled')
) AS v(parent_group, transaction_type, status_key, sort_order, actor, is_terminal, is_success, display_label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_status_flows csf
  WHERE csf.parent_group = v.parent_group
    AND csf.transaction_type = v.transaction_type
    AND csf.status_key = v.status_key
);
