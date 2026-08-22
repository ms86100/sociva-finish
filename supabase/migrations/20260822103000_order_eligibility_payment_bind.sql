-- Production go-live: order eligibility on every path, including payment_pending → placed,
-- and bind Razorpay payments to a specific seller-credit purchase.

CREATE OR REPLACE FUNCTION public.assert_order_seller_eligibility(
  p_seller_id uuid,
  p_buyer_lat double precision,
  p_buyer_lng double precision,
  p_fulfillment_type text,
  p_order_type text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'This seller is currently unavailable for new orders.';
  END IF;

  IF COALESCE(p_order_type, 'cart') IN ('enquiry', 'booking') THEN
    IF NOT public.seller_is_eligible_for_discovery(p_seller_id) THEN
      RAISE EXCEPTION 'This seller is currently unavailable for new orders.';
    END IF;
    IF public.buyer_coordinates_are_valid(p_buyer_lat, p_buyer_lng)
       AND NOT public.seller_is_discoverable_to_buyer(p_seller_id, p_buyer_lat, p_buyer_lng) THEN
      RAISE EXCEPTION 'This seller does not deliver to your location.';
    END IF;
    RETURN;
  END IF;

  IF COALESCE(p_fulfillment_type, 'delivery') = 'self_pickup' THEN
    IF NOT public.seller_is_eligible_for_discovery(p_seller_id) THEN
      RAISE EXCEPTION 'This seller is currently unavailable for new orders.';
    END IF;
    RETURN;
  END IF;

  IF NOT public.buyer_coordinates_are_valid(p_buyer_lat, p_buyer_lng) THEN
    RAISE EXCEPTION 'Your selected address has no location coordinates. Please update it with a precise location.';
  END IF;
  IF NOT public.seller_is_discoverable_to_buyer(p_seller_id, p_buyer_lat, p_buyer_lng) THEN
    RAISE EXCEPTION 'This seller does not deliver to your location.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_enforce_seller_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NULL OR NEW.buyer_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_order_seller_eligibility(
    NEW.seller_id,
    NEW.delivery_lat,
    NEW.delivery_lng,
    NEW.fulfillment_type,
    COALESCE(NEW.order_type, 'cart')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_enforce_seller_eligibility_on_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text <> 'placed' THEN
    RETURN NEW;
  END IF;
  IF NEW.seller_id IS NULL OR NEW.buyer_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_order_seller_eligibility(
    NEW.seller_id,
    NEW.delivery_lat,
    NEW.delivery_lng,
    NEW.fulfillment_type,
    COALESCE(NEW.order_type, 'cart')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_enforce_seller_eligibility ON public.orders;
CREATE TRIGGER trg_orders_enforce_seller_eligibility
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_enforce_seller_eligibility();

DROP TRIGGER IF EXISTS trg_orders_enforce_seller_eligibility_on_place ON public.orders;
CREATE TRIGGER trg_orders_enforce_seller_eligibility_on_place
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_enforce_seller_eligibility_on_place();

CREATE OR REPLACE FUNCTION public.filter_discoverable_seller_ids(
  p_seller_ids uuid[],
  p_buyer_lat double precision,
  p_buyer_lng double precision
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(sid), '{}'::uuid[])
  FROM unnest(COALESCE(p_seller_ids, '{}'::uuid[])) AS sid
  WHERE public.seller_is_discoverable_to_buyer(sid, p_buyer_lat, p_buyer_lng);
$$;

GRANT EXECUTE ON FUNCTION public.assert_order_seller_eligibility(uuid, double precision, double precision, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filter_discoverable_seller_ids(uuid[], double precision, double precision)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_seller_credit_purchase(
  p_purchase_id uuid,
  p_provider_payment_id text,
  p_provider_order_id text DEFAULT NULL,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_credit_purchases;
  v_other public.seller_credit_purchases;
  v_acct public.seller_credit_accounts;
  v_health text;
  v_credits numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF p_purchase_id IS NULL OR p_provider_payment_id IS NULL OR length(btrim(p_provider_payment_id)) < 3 THEN
    RAISE EXCEPTION 'credit purchase and provider payment required';
  END IF;
  IF p_provider_order_id IS NULL OR length(btrim(p_provider_order_id)) < 3 THEN
    RAISE EXCEPTION 'credit purchase order mismatch';
  END IF;

  SELECT * INTO v_other
  FROM public.seller_credit_purchases
  WHERE provider = 'razorpay'
    AND provider_payment_id = p_provider_payment_id
    AND id IS DISTINCT FROM p_purchase_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'payment already applied to another purchase';
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;

  IF NOT public.seller_credit_is_privileged_actor() THEN
    IF v_uid IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.seller_profiles sp
         WHERE sp.id = v_row.seller_id AND sp.user_id = v_uid
       ) THEN
      RAISE EXCEPTION 'seller scope forbidden';
    END IF;
  END IF;

  IF v_row.status = 'captured'
     AND v_row.provider_payment_id IS NOT DISTINCT FROM p_provider_payment_id THEN
    SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'purchase_id', v_row.id,
      'available', COALESCE(v_acct.available, 0)
    );
  END IF;
  IF v_row.status = 'captured' THEN
    RAISE EXCEPTION 'credit purchase already captured';
  END IF;
  IF v_row.provider_order_id IS NULL THEN
    RAISE EXCEPTION 'credit purchase has no provider order';
  END IF;
  IF v_row.provider_order_id IS DISTINCT FROM p_provider_order_id THEN
    RAISE EXCEPTION 'credit purchase order mismatch';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <> v_row.amount THEN
    RAISE EXCEPTION 'credit purchase amount mismatch';
  END IF;

  v_credits := COALESCE(v_row.credits_granted, v_row.amount);

  UPDATE public.seller_credit_purchases
  SET status = 'captured',
      provider_payment_id = p_provider_payment_id,
      provider_order_id = v_row.provider_order_id,
      credits_granted = v_credits,
      captured_at = now(),
      updated_at = now()
  WHERE id = v_row.id
    AND status IS DISTINCT FROM 'captured';

  v_acct := public.seller_credit_ensure_account(v_row.seller_id);
  UPDATE public.seller_credit_accounts
  SET available = available + v_credits,
      lifetime_purchased = lifetime_purchased + v_credits,
      updated_at = now()
  WHERE seller_id = v_row.seller_id
  RETURNING * INTO v_acct;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, reference_id, description
  ) VALUES (
    v_row.seller_id, 'purchase', v_credits, v_row.amount, v_credits, v_acct.available,
    'credit_purchase', v_row.id::text, 'Sociva Credits added'
  );

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = v_row.seller_id;
  PERFORM public.seller_credit_notify(
    v_row.seller_id,
    'seller_credit_purchased',
    'Sociva Credits added',
    public.seller_credit_format_inr(v_credits) || ' Sociva Credits added successfully.'
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'purchase_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_ledger_purchase_once
  ON public.seller_credit_ledger (reference_id)
  WHERE reference_type = 'credit_purchase' AND type = 'purchase';

DO $$
DECLARE
  src text;
  old_radius text;
  new_radius text;
  old_credit text;
  new_credit text;
  old_cart text;
  new_cart text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_multi_vendor_orders'
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  src := replace(src, E'\r\n', E'\n');

  old_radius := $old$
    if _seller_lat is not null and _seller_lng is not null
       and _delivery_lat is not null and _delivery_lng is not null
       and _seller_radius is not null and _seller_radius > 0 then
      _distance := 6371 * acos(
        least(1.0, cos(radians(_seller_lat)) * cos(radians(_delivery_lat))
        * cos(radians(_delivery_lng) - radians(_seller_lng))
        + sin(radians(_seller_lat)) * sin(radians(_delivery_lat)))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    end if;
$old$;

  new_radius := $new$
    if coalesce(_fulfillment_type, 'delivery') <> 'self_pickup' then
      if not public.buyer_coordinates_are_valid(_delivery_lat, _delivery_lng) then
        return json_build_object(
          'success', false,
          'error', 'buyer_location',
          'message', 'Your selected address has no location coordinates. Please update it with a precise location.'
        );
      end if;
      if _seller_lat is null or _seller_lng is null
         or _seller_radius is null or _seller_radius <= 0
         or not public.seller_is_eligible_for_discovery(_seller_id) then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
      _distance := 6371 * acos(
        least(1.0, cos(radians(_seller_lat)) * cos(radians(_delivery_lat))
        * cos(radians(_delivery_lng) - radians(_seller_lng))
        + sin(radians(_seller_lat)) * sin(radians(_delivery_lat)))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    elsif not public.seller_is_eligible_for_discovery(_seller_id) then
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;
$new$;

  IF position(old_radius in src) = 0 THEN
    RAISE EXCEPTION 'create_multi_vendor_orders radius block not found — inspect live definition';
  END IF;
  src := replace(src, old_radius, new_radius);

  old_credit := $old$
    _credit_gate := public.seller_credit_can_accept(_seller_id, 'ORDER_COMPLETED');
    IF COALESCE((_credit_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
$old$;

  new_credit := $new$
    IF NOT public.seller_credit_activation_satisfied(_seller_id) THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    _credit_gate := public.seller_credit_can_accept(_seller_id, 'ORDER_COMPLETED');
    IF COALESCE((_credit_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
$new$;

  IF position(old_credit in src) = 0 THEN
    RAISE EXCEPTION 'create_multi_vendor_orders credit gate not found — inspect live definition';
  END IF;
  src := replace(src, old_credit, new_credit);

  old_cart := $old$
  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;
$old$;

  new_cart := $new$
  if array_length(_credit_blocked_sellers, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object(
      'success', false,
      'error', 'credit_blocked',
      'sellers', to_json(_credit_blocked_sellers),
      'message', 'This seller is currently unavailable for new orders.'
    );
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;
$new$;

  IF position(old_cart in src) = 0 THEN
    RAISE EXCEPTION 'create_multi_vendor_orders cart-clear block not found — inspect live definition';
  END IF;
  src := replace(src, old_cart, new_cart);

  EXECUTE src;
END;
$$;
