-- Seller activation, discovery eligibility, and store-approval notifications.
-- Reuses notification_queue, credit accounts/billing rules, and haversine_km.

CREATE OR REPLACE FUNCTION public.buyer_coordinates_are_valid(
  p_lat double precision,
  p_lng double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_lat IS NOT NULL
    AND p_lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90
    AND p_lng BETWEEN -180 AND 180
    AND NOT (abs(p_lat) < 0.0001 AND abs(p_lng) < 0.0001);
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_activation_satisfied(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_available numeric;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT amount INTO v_amount
  FROM public.seller_billing_rules
  WHERE event_type = 'ORDER_COMPLETED' AND enabled IS TRUE;
  v_amount := COALESCE(v_amount, 0);
  SELECT available INTO v_available
  FROM public.seller_credit_accounts
  WHERE seller_id = p_seller_id;
  RETURN COALESCE(v_available, 0) >= v_amount AND COALESCE(v_available, 0) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_is_eligible_for_discovery(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sp public.seller_profiles;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_sp.verification_status IS DISTINCT FROM 'approved' THEN
    RETURN false;
  END IF;
  IF COALESCE(v_sp.is_available, false) IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF COALESCE(v_sp.vacation_mode, false) THEN
    RETURN false;
  END IF;
  IF v_sp.latitude IS NULL OR v_sp.longitude IS NULL THEN
    RETURN false;
  END IF;
  IF COALESCE(v_sp.delivery_radius_km, 0) <= 0 THEN
    RETURN false;
  END IF;
  RETURN public.seller_credit_activation_satisfied(p_seller_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_is_discoverable_to_buyer(
  p_seller_id uuid,
  p_buyer_lat double precision,
  p_buyer_lng double precision
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sp public.seller_profiles;
  v_distance double precision;
BEGIN
  IF NOT public.buyer_coordinates_are_valid(p_buyer_lat, p_buyer_lng) THEN
    RETURN false;
  END IF;
  IF NOT public.seller_is_eligible_for_discovery(p_seller_id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = p_seller_id;
  v_distance := public.haversine_km(p_buyer_lat, p_buyer_lng, v_sp.latitude, v_sp.longitude);
  RETURN v_distance <= v_sp.delivery_radius_km;
END;
$$;

CREATE OR REPLACE FUNCTION public.buyer_can_order_from_seller(
  p_seller_id uuid,
  p_buyer_lat double precision,
  p_buyer_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.buyer_coordinates_are_valid(p_buyer_lat, p_buyer_lng) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'buyer_location');
  END IF;
  IF NOT public.seller_is_discoverable_to_buyer(p_seller_id, p_buyer_lat, p_buyer_lng) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buyer_coordinates_are_valid(double precision, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_activation_satisfied(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_is_eligible_for_discovery(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_is_discoverable_to_buyer(uuid, double precision, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buyer_can_order_from_seller(uuid, double precision, double precision) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_seller_lifecycle_notification(
  p_user_id uuid,
  p_business_name text,
  p_status text,
  p_seller_id uuid DEFAULT NULL,
  p_rejection_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
  v_type text;
  v_path text;
  v_key text;
BEGIN
  IF p_user_id IS NULL OR p_status IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid())
     AND NOT EXISTS (
       SELECT 1
       FROM public.seller_profiles sp
       WHERE sp.id = p_seller_id
         AND public.is_society_admin(auth.uid(), sp.society_id)
     ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_status = 'approved' THEN
    v_title := 'Your store is now live!';
    v_body := 'Congratulations! Your store has been approved and is now ready for activation. Recharge your Sociva Credits to make your products visible to buyers.';
    v_type := 'seller_approved';
    v_path := '/seller/credits';
  ELSIF p_status = 'rejected' THEN
    v_title := 'Store application rejected';
    v_body := CASE
      WHEN NULLIF(btrim(COALESCE(p_rejection_note, '')), '') IS NOT NULL
        THEN 'Your store application for "' || COALESCE(p_business_name, 'your store') || '" was rejected. Reason: ' || p_rejection_note
      ELSE 'Your store application for "' || COALESCE(p_business_name, 'your store') || '" was rejected. Please review and resubmit.'
    END;
    v_type := 'seller_rejected';
    v_path := '/become-seller';
  ELSIF p_status = 'suspended' THEN
    v_title := 'Store suspended';
    v_body := 'Your store "' || COALESCE(p_business_name, '') || '" has been suspended. Please contact support.';
    v_type := 'seller_suspended';
    v_path := '/seller';
  ELSE
    RETURN;
  END IF;

  v_key := md5(COALESCE(p_seller_id::text, p_user_id::text) || '-' || p_status);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  ) VALUES (
    p_user_id,
    v_title,
    v_body,
    v_type,
    v_path,
    jsonb_build_object(
      'type', v_type,
      'action', CASE p_status
        WHEN 'approved' THEN 'STORE_APPROVED'
        WHEN 'rejected' THEN 'STORE_REJECTED'
        ELSE 'STORE_SUSPENDED'
      END,
      'status', v_type,
      'target_role', 'seller',
      'wa_template', 'sociva_store_status',
      'cta', CASE WHEN p_status = 'approved' THEN '/seller/credits' ELSE v_path END
    ),
    v_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_seller_lifecycle_notification(uuid, text, text, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_enqueue_seller_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status IN ('approved', 'rejected', 'suspended') THEN
    PERFORM public.enqueue_seller_lifecycle_notification(
      NEW.user_id,
      NEW.business_name,
      NEW.verification_status,
      NEW.id,
      NEW.rejection_note
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_seller_status_notification ON public.seller_profiles;
CREATE TRIGGER trg_enqueue_seller_status_notification
  AFTER UPDATE OF verification_status ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enqueue_seller_status_notification();

CREATE OR REPLACE FUNCTION public.create_seller_credit_purchase_amount(
  p_seller_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_amount numeric;
BEGIN
  IF NOT public.seller_credit_flag_enabled('seller_credit_purchase_enabled') THEN
    RAISE EXCEPTION 'Sociva Credit purchases are not enabled yet';
  END IF;
  IF NOT public.is_admin(auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles
       WHERE id = p_seller_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;
  v_amount := round(COALESCE(p_amount, 0), 2);
  IF v_amount < 100 THEN
    RAISE EXCEPTION 'Minimum recharge amount is ₹100';
  END IF;
  IF v_amount > 100000 THEN
    RAISE EXCEPTION 'Maximum recharge amount is ₹1,00,000';
  END IF;

  PERFORM public.seller_credit_ensure_account(p_seller_id);

  INSERT INTO public.seller_credit_purchases(
    seller_id, package_id, amount, credits_granted, status, created_by, metadata
  ) VALUES (
    p_seller_id, NULL, v_amount, v_amount, 'created', auth.uid(),
    jsonb_build_object('custom_amount', v_amount, 'credits_granted', v_amount)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_id,
    'amount', v_amount,
    'credits_granted', v_amount,
    'seller_id', p_seller_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seller_credit_purchase_amount(uuid, numeric)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_seller_credit_flag(p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_key NOT IN ('seller_credit_purchase_enabled', 'seller_credit_spend_enabled') THEN
    RAISE EXCEPTION 'unknown credit flag';
  END IF;
  IF p_key = 'seller_credit_spend_enabled' AND p_enabled THEN
    v_ready := public.seller_credit_resolution_ready();
    IF COALESCE((v_ready->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Set booking grace minutes and buyer no-show policy before enabling Spend';
    END IF;
  END IF;
  PERFORM set_config('app.financial_control_approved', 'true', true);
  UPDATE public.financial_feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.filter_discoverable_product_ids(
  p_product_ids uuid[],
  p_buyer_lat double precision,
  p_buyer_lng double precision
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[])
  FROM public.products p
  WHERE p.id = ANY(p_product_ids)
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND public.seller_is_discoverable_to_buyer(p.seller_id, p_buyer_lat, p_buyer_lng);
$$;

GRANT EXECUTE ON FUNCTION public.filter_discoverable_product_ids(uuid[], double precision, double precision)
  TO anon, authenticated, service_role;

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
  IF NEW.status IN ('cancelled', 'payment_pending') THEN
    RETURN NEW;
  END IF;
  IF NOT public.seller_is_eligible_for_discovery(NEW.seller_id) THEN
    RAISE EXCEPTION 'This seller is currently unavailable for new orders.';
  END IF;
  IF COALESCE(NEW.order_type, 'cart') IN ('enquiry', 'booking') THEN
    IF public.buyer_coordinates_are_valid(NEW.delivery_lat, NEW.delivery_lng)
       AND NOT public.seller_is_discoverable_to_buyer(NEW.seller_id, NEW.delivery_lat, NEW.delivery_lng) THEN
      RAISE EXCEPTION 'This seller does not deliver to your location.';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.buyer_coordinates_are_valid(NEW.delivery_lat, NEW.delivery_lng) THEN
    RAISE EXCEPTION 'Your selected address has no location coordinates. Please update it with a precise location.';
  END IF;
  IF NOT public.seller_is_discoverable_to_buyer(NEW.seller_id, NEW.delivery_lat, NEW.delivery_lng) THEN
    RAISE EXCEPTION 'This seller does not deliver to your location.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_enforce_seller_eligibility ON public.orders;
CREATE TRIGGER trg_orders_enforce_seller_eligibility
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_enforce_seller_eligibility();

