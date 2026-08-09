-- ============================================================
-- Phase 0 HARDENED — order status fail-closed + settlement gate + stock
-- Fail-closed rationale: null acting_as / unpaid settlement / free stock
-- after paid-resurrect must never succeed silently.
-- ============================================================

-- ------------------------------------------------------------
-- 1) validate_order_status_transition: REQUIRE acting_as (or privileged)
--    Narrow payment_pending exit to payment/system/buyer only.
-- ------------------------------------------------------------
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

  -- PostgREST service_role JWT path (edge confirm / webhooks)
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  -- OTP-verified delivery handoff
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;

  _acting_as := nullif(current_setting('app.acting_as', true), '');

  -- Fail-closed: every status transition needs an explicit actor.
  -- SECURITY DEFINER RPCs set app.acting_as via set_config(..., true).
  IF _acting_as IS NULL THEN
    RAISE EXCEPTION 'app.acting_as required for status transition % → % (fail-closed)',
      OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  -- Privileged payment / system actors (confirm, expire, auto-cancel)
  IF _acting_as IN ('payment', 'system') THEN
    RETURN NEW;
  END IF;

  -- payment_pending may only be left by payment RPCs, system, or buyer cancel —
  -- never by a bare client UPDATE forging placed/paid.
  IF OLD.status::text = 'payment_pending'
     AND _acting_as NOT IN ('payment', 'system', 'buyer') THEN
    RAISE EXCEPTION 'Leaving payment_pending requires payment/system/buyer acting_as (got %)',
      _acting_as
      USING ERRCODE = '42501';
  END IF;

  -- Still allow payment_pending → * once actor is authorized (buyer cancel / payment confirm via RPC)
  IF OLD.status::text = 'payment_pending' AND _acting_as IN ('payment', 'system', 'buyer') THEN
    RETURN NEW;
  END IF;

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

  NEW.transaction_type := _txn_type;

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

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%, actor=%)',
      OLD.status, NEW.status, _parent_group, _txn_type, _acting_as;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.validate_order_status_transition() IS
  'Fail-closed status gate: null acting_as REJECT; payment_pending exit only for payment/system/buyer; service_role JWT bypass for edge.';

-- ------------------------------------------------------------
-- 2) Block direct client UPDATE of orders.status / payment_status
--    when acting_as is unset (RPCs set_config first).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_status_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _acting text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status THEN
    RETURN NEW;
  END IF;

  -- session role from PostgREST JWT
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER function owner (postgres / supabase_admin) is fine when acting_as set
  _acting := nullif(current_setting('app.acting_as', true), '');
  IF current_user IN ('authenticated', 'anon') AND _acting IS NULL THEN
    RAISE EXCEPTION 'Direct client UPDATE of orders.status/payment_status denied — use RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_status_client_update ON public.orders;
CREATE TRIGGER trg_guard_order_status_client_update
  BEFORE UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_status_client_update();

-- ------------------------------------------------------------
-- 3) Settlement create gate: only when payment is actually paid / COD-ok
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
  _loyalty_subsidy numeric;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _gross_before numeric;
  _pay text;
  _ptype text;
BEGIN
  IF p_old.status IS NOT DISTINCT FROM p_new.status THEN RETURN; END IF;
  IF p_new.status NOT IN ('delivered', 'completed') THEN RETURN; END IF;

  -- Fail-closed: never create settlement for unpaid orders
  _pay := COALESCE(p_new.payment_status, '');
  _ptype := COALESCE(p_new.payment_type, '');

  IF _pay IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    NULL; -- online / verified paid
  ELSIF lower(_ptype) IN ('cod', 'cash_on_delivery')
        AND _pay IN ('pending', 'cod_pending', 'unpaid', '')
        AND p_new.status IN ('delivered', 'completed') THEN
    -- COD: payment collected on delivery — allow settlement at terminal success
    NULL;
  ELSE
    RAISE WARNING 'create_settlement_on_delivery_impl skipped: unpaid order % pay=% type=%',
      p_new.id, _pay, _ptype;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.seller_settlements WHERE order_id = p_new.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(value::integer, 48) INTO _cooldown_hours
  FROM public.system_settings WHERE key = 'settlement_cooldown_hours';
  IF _cooldown_hours IS NULL THEN _cooldown_hours := 48; END IF;

  SELECT COALESCE(pr.platform_fee, 0) INTO _platform_fee
  FROM public.payment_records pr WHERE pr.order_id = p_new.id LIMIT 1;
  IF _platform_fee IS NULL THEN _platform_fee := 0; END IF;

  _loyalty_subsidy := COALESCE(p_new.loyalty_discount_amount, 0);
  _wallet_cash := COALESCE(p_new.wallet_cash_amount, 0);
  _wallet_promo := COALESCE(p_new.wallet_promo_amount, 0);
  _gross_before := COALESCE(p_new.total_amount, 0) + _loyalty_subsidy + _wallet_cash + _wallet_promo;
  _gross := _gross_before;
  _net := _gross - _platform_fee;

  SELECT society_id INTO _society_id FROM public.profiles WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    platform_loyalty_subsidy, gross_before_loyalty,
    wallet_cash_applied, wallet_promo_applied,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(_society_id, p_new.buyer_society_id),
    _gross, _platform_fee, COALESCE(p_new.delivery_fee, 0), _net,
    _loyalty_subsidy, COALESCE(p_new.total_amount, 0) + _loyalty_subsidy,
    _wallet_cash, _wallet_promo,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );
END;
$$;

COMMENT ON FUNCTION public.create_settlement_on_delivery_impl(orders, orders) IS
  'Creates seller_settlements only when payment is paid/verified or COD collected at delivery — never for unpaid online.';

-- Settlement notify: never claim "paid/released" without a transfer id
CREATE OR REPLACE FUNCTION public.enqueue_seller_settlement_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _title text;
  _body text;
  _status text;
  _amount numeric;
  _transfer text;
BEGIN
  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  _amount := COALESCE(NEW.net_amount, 0);
  _status := COALESCE(NEW.settlement_status, NEW.status);
  _transfer := NULLIF(COALESCE(NEW.razorpay_transfer_id, ''), '');

  IF TG_OP = 'INSERT' THEN
    _title := 'Settlement pending';
    _body := 'A settlement of ₹' || _amount || ' was created and will become eligible after cooldown.';
    _status := 'settlement_pending';
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(NEW.settlement_status, NEW.status) IS DISTINCT FROM COALESCE(OLD.settlement_status, OLD.status)
  THEN
    IF COALESCE(NEW.settlement_status, NEW.status) IN ('eligible') THEN
      _title := 'Settlement eligible';
      _body := '₹' || _amount || ' is now eligible for payout (not yet transferred).';
      _status := 'settlement_eligible';
    ELSIF COALESCE(NEW.settlement_status, NEW.status) IN ('settled', 'released', 'paid') THEN
      -- Fail-honest: only say paid when a transfer id exists
      IF _transfer IS NOT NULL THEN
        _title := 'Settlement paid';
        _body := '₹' || _amount || ' has been released to your account. Ref: ' || _transfer;
        _status := 'settlement_paid';
      ELSE
        _title := 'Settlement recorded';
        _body := '₹' || _amount || ' marked settled internally — payout transfer pending confirmation.';
        _status := 'settlement_recorded';
      END IF;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    _title,
    _body,
    'settlement',
    '/seller/settlements',
    jsonb_build_object(
      'settlement_id', NEW.id,
      'order_id', NEW.order_id,
      'amount', _amount,
      'status', _status,
      'transfer_id', _transfer,
      'target_role', 'seller'
    )
  );
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 4) Stock restore on cancelled + rejected; idempotent stock_restored flag
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_restored boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
BEGIN
  -- Restore on all fail terminals that free inventory
  IF p_new.status::text IN ('cancelled', 'rejected')
     AND p_old.status::text IS DISTINCT FROM p_new.status::text THEN
    UPDATE public.products p
    SET
      stock_quantity = p.stock_quantity + oi.quantity,
      is_available = CASE
        WHEN p.stock_quantity + oi.quantity > 0 THEN true
        ELSE p.is_available
      END
    FROM public.order_items oi
    WHERE oi.order_id = p_new.id
      AND oi.product_id = p.id
      AND p.stock_quantity IS NOT NULL
      AND COALESCE(oi.stock_restored, false) = false;

    UPDATE public.order_items
    SET stock_restored = true
    WHERE order_id = p_new.id
      AND COALESCE(stock_restored, false) = false;
  END IF;
END;
$f$;

COMMENT ON FUNCTION public.restore_stock_on_cancel_impl(orders, orders) IS
  'Idempotent restock on cancelled/rejected via order_items.stock_restored flag.';

-- Re-hold stock when paying after cancel (resurrect) — never paid with free stock
CREATE OR REPLACE FUNCTION public.rehold_stock_for_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_updated int := 0;
BEGIN
  FOR r IN
    SELECT oi.id AS item_id, oi.product_id, oi.quantity, oi.stock_restored
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    -- Only re-hold units that were restored on cancel/reject (idempotent)
    IF COALESCE(r.stock_restored, false) IS NOT TRUE THEN
      CONTINUE;
    END IF;

    UPDATE public.products p
    SET stock_quantity = p.stock_quantity - r.quantity,
        is_available = CASE
          WHEN p.stock_quantity - r.quantity <= 0 THEN false
          ELSE p.is_available
        END
    WHERE p.id = r.product_id
      AND p.stock_quantity IS NOT NULL
      AND p.stock_quantity >= r.quantity;

    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = r.product_id AND p.stock_quantity IS NOT NULL
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'insufficient_stock',
          'product_id', r.product_id
        );
      END IF;
      -- Non-tracked stock: clear flag anyway
    ELSE
      v_updated := v_updated + 1;
    END IF;

    UPDATE public.order_items
    SET stock_restored = false
    WHERE id = r.item_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'items_reheld', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.rehold_stock_for_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rehold_stock_for_order(uuid) TO service_role;

-- Atomic resurrect: re-hold stock OR fail (leave path for refund — never paid free stock)
CREATE OR REPLACE FUNCTION public.resurrect_cancelled_order_after_payment(
  p_order_id uuid,
  p_razorpay_payment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o public.orders;
  v_hold jsonb;
BEGIN
  PERFORM set_config('app.acting_as', 'payment', true);

  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF o.status::text <> 'cancelled' OR COALESCE(o.payment_status, '') <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_eligible', 'status', o.status, 'payment_status', o.payment_status);
  END IF;

  v_hold := public.rehold_stock_for_order(p_order_id);
  IF COALESCE(v_hold->>'success', 'false') <> 'true' THEN
    -- Fail confirm path: do not mark paid — caller should refund
    RETURN jsonb_build_object(
      'success', false,
      'error', 'rehold_failed',
      'detail', v_hold
    );
  END IF;

  UPDATE public.orders
  SET status = 'placed',
      payment_status = 'paid',
      razorpay_payment_id = p_razorpay_payment_id,
      rejection_reason = null,
      failure_owner = null,
      updated_at = now()
  WHERE id = p_order_id
    AND status = 'cancelled'
    AND payment_status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'concurrent_update');
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'rehold', v_hold);
END;
$$;

REVOKE ALL ON FUNCTION public.resurrect_cancelled_order_after_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resurrect_cancelled_order_after_payment(uuid, text) TO service_role;

-- Seller settlement totals: pending owed excludes on_hold/disputed
CREATE OR REPLACE FUNCTION public.get_seller_settlement_totals(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN jsonb_build_object('total_settled', 0, 'total_pending', 0, 'total_on_hold', 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) AS sid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = sid.id AND sp.user_id = v_uid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT jsonb_build_object(
    'total_settled', COALESCE(SUM(ss.net_amount) FILTER (WHERE ss.settlement_status = 'settled'), 0),
    'total_pending', COALESCE(SUM(ss.net_amount) FILTER (
      WHERE ss.settlement_status IN ('pending', 'eligible', 'processing')
    ), 0),
    'total_on_hold', COALESCE(SUM(ss.net_amount) FILTER (
      WHERE ss.settlement_status IN ('on_hold', 'disputed')
    ), 0)
  )
  INTO v_result
  FROM public.seller_settlements ss
  WHERE ss.seller_id = ANY (p_seller_ids);

  RETURN COALESCE(v_result, jsonb_build_object('total_settled', 0, 'total_pending', 0, 'total_on_hold', 0));
END;
$$;
