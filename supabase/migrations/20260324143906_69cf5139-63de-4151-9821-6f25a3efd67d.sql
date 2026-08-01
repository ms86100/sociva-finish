
-- 1. Create order_otp_codes table for generic OTP
CREATE TABLE public.order_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  target_status text NOT NULL,
  otp_code text NOT NULL,
  otp_hash text NOT NULL,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 minutes'),
  UNIQUE(order_id, target_status)
);

ALTER TABLE public.order_otp_codes ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can read codes for their own orders
CREATE POLICY "Users can read own order OTP codes"
  ON public.order_otp_codes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_otp_codes.order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id IN (
          SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()
        ))
    )
  );

-- 2. RPC: generate_generic_otp
CREATE OR REPLACE FUNCTION public.generate_generic_otp(_order_id uuid, _target_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _order_record public.orders;
  _seller_user_id uuid;
  _code text;
  _hash text;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _order_record FROM public.orders WHERE id = _order_id;
  IF _order_record.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Auth: caller must be buyer or seller of this order
  SELECT sp.user_id INTO _seller_user_id
  FROM public.seller_profiles sp WHERE sp.id = _order_record.seller_id;

  IF _caller_id IS DISTINCT FROM _order_record.buyer_id
     AND _caller_id IS DISTINCT FROM _seller_user_id THEN
    RAISE EXCEPTION 'Not authorized for this order';
  END IF;

  -- Generate 4-digit code
  _code := lpad(floor(random() * 10000)::int::text, 4, '0');
  _hash := encode(digest(_code, 'sha256'), 'hex');

  INSERT INTO public.order_otp_codes (order_id, target_status, otp_code, otp_hash, verified, expires_at)
  VALUES (_order_id, _target_status, _code, _hash, false, now() + interval '30 minutes')
  ON CONFLICT (order_id, target_status)
  DO UPDATE SET otp_code = _code, otp_hash = _hash, verified = false, expires_at = now() + interval '30 minutes', created_at = now();

  RETURN _code;
END;
$$;

-- 3. RPC: verify_generic_otp_and_advance
CREATE OR REPLACE FUNCTION public.verify_generic_otp_and_advance(
  _order_id uuid,
  _otp_code text,
  _target_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id uuid;
  _order_record public.orders;
  _seller_user_id uuid;
  _otp_record public.order_otp_codes;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _order_record FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order_record.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Auth: caller must be buyer or seller
  SELECT sp.user_id INTO _seller_user_id
  FROM public.seller_profiles sp WHERE sp.id = _order_record.seller_id;

  IF _caller_id IS DISTINCT FROM _order_record.buyer_id
     AND _caller_id IS DISTINCT FROM _seller_user_id THEN
    RAISE EXCEPTION 'Not authorized for this order';
  END IF;

  -- Get OTP record
  SELECT * INTO _otp_record
  FROM public.order_otp_codes
  WHERE order_id = _order_id AND target_status = _target_status;

  IF _otp_record.id IS NULL THEN
    RAISE EXCEPTION 'No OTP code found for this step';
  END IF;

  IF _otp_record.verified THEN
    RAISE EXCEPTION 'OTP already used';
  END IF;

  IF _otp_record.expires_at < now() THEN
    RAISE EXCEPTION 'OTP has expired. Please request a new code.';
  END IF;

  IF btrim(_otp_record.otp_code) <> btrim(_otp_code) THEN
    RAISE EXCEPTION 'Invalid OTP code';
  END IF;

  -- Mark verified
  UPDATE public.order_otp_codes SET verified = true WHERE id = _otp_record.id;

  -- Set session var so trigger passes
  PERFORM set_config('app.otp_verified', 'true', true);

  -- Determine acting_as based on caller
  IF _caller_id = _seller_user_id THEN
    PERFORM set_config('app.acting_as', 'seller', true);
  ELSIF _caller_id = _order_record.buyer_id THEN
    PERFORM set_config('app.acting_as', 'buyer', true);
  END IF;

  -- Advance order
  UPDATE public.orders
  SET status = _target_status::order_status,
      status_updated_at = now()
  WHERE id = _order_id;
END;
$$;

-- 4. Update enforce_delivery_otp_gate → enforce_otp_gate (unified)
-- First drop old trigger
DROP TRIGGER IF EXISTS enforce_delivery_otp_gate ON public.orders;

CREATE OR REPLACE FUNCTION public.enforce_otp_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp_type text;
  v_parent_group text;
  v_transaction_type text;
  has_delivery_code boolean;
  has_verified_generic boolean;
BEGIN
  -- Only check on status change
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- If OTP already verified in this transaction, pass through
  IF current_setting('app.otp_verified', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Resolve workflow context
  v_transaction_type := COALESCE(NEW.transaction_type, 'seller_delivery');

  SELECT sp.primary_group INTO v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;
  v_parent_group := COALESCE(v_parent_group, 'default');

  -- Look up otp_type for the target status
  SELECT csf.otp_type INTO v_otp_type
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status::text
    AND csf.transaction_type = v_transaction_type
    AND csf.parent_group = v_parent_group
  LIMIT 1;

  -- Fallback to default group
  IF v_otp_type IS NULL THEN
    SELECT csf.otp_type INTO v_otp_type
    FROM public.category_status_flows csf
    WHERE csf.status_key = NEW.status::text
      AND csf.transaction_type = v_transaction_type
      AND csf.parent_group = 'default'
    LIMIT 1;
  END IF;

  -- No OTP required
  IF v_otp_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- DELIVERY OTP: check delivery_assignments
  IF v_otp_type = 'delivery' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.delivery_assignments
      WHERE order_id = NEW.id
        AND delivery_code IS NOT NULL
        AND status NOT IN ('cancelled', 'failed')
    ) INTO has_delivery_code;

    IF has_delivery_code THEN
      RAISE EXCEPTION 'Delivery OTP verification required. Use the verify_delivery_otp_and_complete function.';
    END IF;
    -- No delivery assignment = no enforcement (graceful)
    RETURN NEW;
  END IF;

  -- GENERIC OTP: check order_otp_codes
  IF v_otp_type = 'generic' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_otp_codes
      WHERE order_id = NEW.id
        AND target_status = NEW.status::text
        AND verified = true
        AND expires_at > now()
    ) INTO has_verified_generic;

    IF NOT has_verified_generic THEN
      RAISE EXCEPTION 'OTP verification required for this step. Use the verify_generic_otp_and_advance function.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_otp_gate
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_otp_gate();

-- Enable realtime for order_otp_codes
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_otp_codes;
