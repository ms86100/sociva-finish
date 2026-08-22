-- Sociva Credits: prepaid seller → platform usage.
-- Separate from seller_settlements (Sociva owes seller) and buyer_wallets.
-- Do not post into finance.ledger. Flags default OFF.

INSERT INTO public.financial_feature_flags(key, enabled, description)
VALUES
  ('seller_credit_purchase_enabled', false, 'Allow sellers to buy Sociva Credits via Razorpay'),
  ('seller_credit_spend_enabled', false, 'Charge and gate new orders/enquiries/bookings/contacts')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.seller_credit_accounts (
  seller_id uuid PRIMARY KEY REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  available numeric(12,2) NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved numeric(12,2) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  lifetime_purchased numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_purchased >= 0),
  lifetime_consumed numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_consumed >= 0),
  lifetime_adjusted numeric(12,2) NOT NULL DEFAULT 0,
  last_health text NOT NULL DEFAULT 'exhausted'
    CHECK (last_health IN ('healthy', 'low', 'critical', 'exhausted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_credit_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seller_credit_packages(amount, label, sort_order)
VALUES
  (100, '₹100', 10),
  (500, '₹500', 20),
  (1000, '₹1,000', 30),
  (2500, '₹2,500', 40),
  (5000, '₹5,000', 50)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.seller_credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  package_id uuid REFERENCES public.seller_credit_packages(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'failed', 'captured', 'void')),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_purchases_payment
  ON public.seller_credit_purchases (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_credit_purchases_seller
  ON public.seller_credit_purchases (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'purchase', 'reservation', 'event_charge', 'reservation_release',
    'admin_adjustment', 'reversal'
  )),
  event_type text,
  amount numeric(12,2) NOT NULL,
  configured_price numeric(12,2),
  charged_amount numeric(12,2),
  balance_after numeric(12,2) NOT NULL,
  reference_type text,
  reference_id text,
  description text,
  status text NOT NULL DEFAULT 'completed',
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_ledger_event_once
  ON public.seller_credit_ledger (event_type, reference_type, reference_id)
  WHERE type = 'event_charge' AND event_type IS NOT NULL AND reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_credit_ledger_seller
  ON public.seller_credit_ledger (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  configured_price numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'committed', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_reservations_held
  ON public.seller_credit_reservations (event_type, reference_type, reference_id)
  WHERE status = 'held';

CREATE TABLE IF NOT EXISTS public.seller_billing_rules (
  event_type text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_billing_rule_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  old_amount numeric(12,2),
  new_amount numeric(12,2),
  old_enabled boolean,
  new_enabled boolean,
  reason text,
  admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seller_billing_rules(event_type, enabled, amount)
VALUES
  ('ORDER_COMPLETED', true, 10),
  ('ENQUIRY_CREATED', true, 10),
  ('SERVICE_BOOKING', true, 10),
  ('CONTACT_REQUEST', true, 10)
ON CONFLICT (event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.seller_credit_thresholds (
  key text PRIMARY KEY,
  value numeric(12,2) NOT NULL
);

INSERT INTO public.seller_credit_thresholds(key, value)
VALUES
  ('healthy_min', 100),
  ('low_min', 50),
  ('critical_min', 1)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.seller_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_billing_rule_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_thresholds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_credit_accounts FROM PUBLIC, anon;
REVOKE ALL ON public.seller_credit_purchases FROM PUBLIC, anon;
REVOKE ALL ON public.seller_credit_ledger FROM PUBLIC, anon;
REVOKE ALL ON public.seller_credit_reservations FROM PUBLIC, anon;
REVOKE ALL ON public.seller_billing_rule_audit FROM PUBLIC, anon;

CREATE POLICY seller_credit_accounts_select ON public.seller_credit_accounts
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY seller_credit_purchases_select ON public.seller_credit_purchases
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY seller_credit_ledger_select ON public.seller_credit_ledger
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY seller_credit_reservations_select ON public.seller_credit_reservations
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY seller_billing_rules_select ON public.seller_billing_rules
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY seller_credit_packages_select ON public.seller_credit_packages
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY seller_credit_packages_admin ON public.seller_credit_packages
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY seller_billing_audit_admin ON public.seller_billing_rule_audit
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY seller_credit_thresholds_select ON public.seller_credit_thresholds
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.seller_credit_flag_enabled(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.financial_feature_flags WHERE key = p_key), false);
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_ensure_account(p_seller_id uuid)
RETURNS public.seller_credit_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_credit_accounts;
BEGIN
  INSERT INTO public.seller_credit_accounts(seller_id)
  VALUES (p_seller_id)
  ON CONFLICT (seller_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.seller_credit_accounts
  WHERE seller_id = p_seller_id
  FOR UPDATE;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_rule(p_event_type text)
RETURNS TABLE(enabled boolean, amount numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.seller_credit_flag_enabled('seller_credit_spend_enabled') THEN
    enabled := false;
    amount := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT r.enabled, r.amount
  INTO enabled, amount
  FROM public.seller_billing_rules r
  WHERE r.event_type = p_event_type;

  IF NOT FOUND THEN
    enabled := false;
    amount := 0;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_health_for(p_available numeric)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_available <= 0 THEN 'exhausted'
    WHEN p_available < COALESCE((SELECT value FROM public.seller_credit_thresholds WHERE key = 'low_min'), 50)
      THEN 'critical'
    WHEN p_available < COALESCE((SELECT value FROM public.seller_credit_thresholds WHERE key = 'healthy_min'), 100)
      THEN 'low'
    ELSE 'healthy'
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_notify(
  p_seller_id uuid,
  p_type text,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_key text;
BEGIN
  SELECT user_id INTO v_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_user IS NULL THEN RETURN; END IF;
  v_key := md5(p_seller_id::text || '-' || p_type || '-' || date_trunc('hour', now())::text);
  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, action_url, payload, idempotency_key)
  VALUES (
    v_user,
    p_title,
    p_body,
    p_type,
    '/seller/credits',
    '/seller/credits',
    jsonb_build_object('seller_id', p_seller_id, 'target_role', 'seller'),
    v_key
  )
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_maybe_notify_health(
  p_seller_id uuid,
  p_old_health text,
  p_new_health text,
  p_available numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_old_health IS NOT DISTINCT FROM p_new_health THEN
    RETURN;
  END IF;
  IF p_new_health = 'exhausted' THEN
    PERFORM public.seller_credit_notify(
      p_seller_id,
      'seller_credit_exhausted',
      'Sociva Credits exhausted',
      'Your Sociva Credits are exhausted. Recharge to start accepting new orders again.'
    );
  ELSIF p_new_health IN ('low', 'critical') AND p_old_health = 'healthy' THEN
    PERFORM public.seller_credit_notify(
      p_seller_id,
      'seller_credit_low',
      'Sociva Credits running low',
      'Your Sociva Credits are running low. You have ₹' || trim(to_char(p_available, 'FM999999990.00')) || ' remaining. Recharge now to keep receiving new orders and requests.'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_can_accept(
  p_seller_id uuid,
  p_event_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_acct public.seller_credit_accounts;
BEGIN
  SELECT * INTO v_rule FROM public.seller_credit_rule(p_event_type);
  IF NOT COALESCE(v_rule.enabled, false) OR COALESCE(v_rule.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'gated', false, 'required', 0, 'available', 0);
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  RETURN jsonb_build_object(
    'ok', v_acct.available >= v_rule.amount,
    'gated', true,
    'required', v_rule.amount,
    'available', v_acct.available,
    'reason', CASE
      WHEN v_acct.available >= v_rule.amount THEN NULL
      ELSE 'SELLER_CREDIT_INSUFFICIENT: This store is temporarily unavailable for new orders.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_seller_billable_event(
  p_seller_id uuid,
  p_event_type text,
  p_reference_type text,
  p_reference_id text,
  p_mode text,
  p_description text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_acct public.seller_credit_accounts;
  v_res public.seller_credit_reservations;
  v_health text;
  v_old_health text;
BEGIN
  IF p_mode NOT IN ('charge', 'reserve', 'commit', 'release') THEN
    RAISE EXCEPTION 'invalid credit mode';
  END IF;

  SELECT * INTO v_rule FROM public.seller_credit_rule(p_event_type);
  IF NOT COALESCE(v_rule.enabled, false) OR COALESCE(v_rule.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'disabled');
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_old_health := v_acct.last_health;

  IF p_mode = 'charge' THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE type = 'event_charge'
        AND event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    IF v_acct.available < v_rule.amount THEN
      RAISE EXCEPTION 'SELLER_CREDIT_INSUFFICIENT: This store is temporarily unavailable for new orders.';
    END IF;
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        lifetime_consumed = lifetime_consumed + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'event_charge', p_event_type, -v_rule.amount, v_rule.amount, v_rule.amount,
      v_acct.available, p_reference_type, p_reference_id, p_description, p_created_by
    );

  ELSIF p_mode = 'reserve' THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_reservations
      WHERE event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
        AND status IN ('held', 'committed')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    IF v_acct.available < v_rule.amount THEN
      RAISE EXCEPTION 'SELLER_CREDIT_INSUFFICIENT: This store is temporarily unavailable for new orders.';
    END IF;
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        reserved = reserved + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_reservations(
      seller_id, event_type, reference_type, reference_id, amount, configured_price, status
    ) VALUES (
      p_seller_id, p_event_type, p_reference_type, p_reference_id, v_rule.amount, v_rule.amount, 'held'
    );
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'reservation', p_event_type, -v_rule.amount, v_rule.amount, 0,
      v_acct.available, p_reference_type, p_reference_id, p_description, p_created_by
    );

  ELSIF p_mode = 'commit' THEN
    SELECT * INTO v_res
    FROM public.seller_credit_reservations
    WHERE event_type = p_event_type
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
      AND status = 'held'
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_reservation');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE type = 'event_charge'
        AND event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    UPDATE public.seller_credit_reservations
    SET status = 'committed', updated_at = now()
    WHERE id = v_res.id;
    UPDATE public.seller_credit_accounts
    SET reserved = reserved - v_res.amount,
        lifetime_consumed = lifetime_consumed + v_res.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'event_charge', p_event_type, -v_res.amount, v_res.configured_price, v_res.amount,
      v_acct.available, p_reference_type, p_reference_id, p_description, p_created_by
    );

  ELSIF p_mode = 'release' THEN
    SELECT * INTO v_res
    FROM public.seller_credit_reservations
    WHERE event_type = p_event_type
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
      AND status = 'held'
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_reservation');
    END IF;
    UPDATE public.seller_credit_reservations
    SET status = 'released', updated_at = now()
    WHERE id = v_res.id;
    UPDATE public.seller_credit_accounts
    SET reserved = reserved - v_res.amount,
        available = available + v_res.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'reservation_release', p_event_type, v_res.amount, v_res.configured_price, 0,
      v_acct.available, p_reference_type, p_reference_id, p_description, p_created_by
    );
  END IF;

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts
  SET last_health = v_health, updated_at = now()
  WHERE seller_id = p_seller_id;
  PERFORM public.seller_credit_maybe_notify_health(p_seller_id, v_old_health, v_health, v_acct.available);

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'reserved', v_acct.reserved);
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_event_for_order(p_order public.orders)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_order.order_type = 'enquiry' THEN 'ENQUIRY_CREATED'
    WHEN p_order.order_type = 'booking' OR p_order.transaction_type = 'service_booking' THEN 'SERVICE_BOOKING'
    ELSE 'ORDER_COMPLETED'
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_on_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  IF NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_event := public.seller_credit_event_for_order(NEW);
  IF v_event = 'ENQUIRY_CREATED' THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'charge',
      'New enquiry', NEW.buyer_id
    );
  ELSE
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'reserve',
      CASE WHEN v_event = 'SERVICE_BOOKING' THEN 'Booking reserved' ELSE 'Order reserved' END,
      NEW.buyer_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_credit_on_order_insert ON public.orders;
CREATE TRIGGER trg_seller_credit_on_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.seller_credit_on_order_insert();

CREATE OR REPLACE FUNCTION public.seller_credit_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_event := public.seller_credit_event_for_order(NEW);
  IF v_event = 'ENQUIRY_CREATED' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('completed', 'delivered', 'buyer_received') THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'commit',
      'Successful fulfilment', NULL
    );
  ELSIF NEW.status IN ('cancelled', 'rejected', 'failed', 'returned', 'no_show') THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'release',
      'Released unused reservation', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_credit_on_order_status ON public.orders;
CREATE TRIGGER trg_seller_credit_on_order_status
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.seller_credit_on_order_status();

CREATE OR REPLACE FUNCTION public.create_seller_credit_purchase(
  p_seller_id uuid,
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack public.seller_credit_packages;
  v_id uuid;
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

  SELECT * INTO v_pack
  FROM public.seller_credit_packages
  WHERE id = p_package_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credit package';
  END IF;

  PERFORM public.seller_credit_ensure_account(p_seller_id);

  INSERT INTO public.seller_credit_purchases(seller_id, package_id, amount, status, created_by)
  VALUES (p_seller_id, p_package_id, v_pack.amount, 'created', auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_id,
    'amount', v_pack.amount,
    'seller_id', p_seller_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_seller_credit_provider_order(
  p_purchase_id uuid,
  p_provider_order_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.seller_credit_purchases
  SET provider_order_id = p_provider_order_id, updated_at = now()
  WHERE id = p_purchase_id;
END;
$$;

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
  v_acct public.seller_credit_accounts;
  v_old_health text;
  v_health text;
BEGIN
  IF p_provider_payment_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.seller_credit_purchases
    WHERE provider = 'razorpay' AND provider_payment_id = p_provider_payment_id;
    IF FOUND AND v_row.status = 'captured' THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'purchase_id', v_row.id);
    END IF;
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;
  IF v_row.status = 'captured' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'purchase_id', v_row.id);
  END IF;
  IF p_amount IS NOT NULL AND p_amount <> v_row.amount THEN
    RAISE EXCEPTION 'credit purchase amount mismatch';
  END IF;

  UPDATE public.seller_credit_purchases
  SET status = 'captured',
      provider_payment_id = p_provider_payment_id,
      provider_order_id = COALESCE(p_provider_order_id, provider_order_id),
      updated_at = now()
  WHERE id = v_row.id;

  v_acct := public.seller_credit_ensure_account(v_row.seller_id);
  v_old_health := v_acct.last_health;
  UPDATE public.seller_credit_accounts
  SET available = available + v_row.amount,
      lifetime_purchased = lifetime_purchased + v_row.amount,
      updated_at = now()
  WHERE seller_id = v_row.seller_id
  RETURNING * INTO v_acct;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, reference_id, description
  ) VALUES (
    v_row.seller_id, 'purchase', v_row.amount, v_row.amount, v_row.amount, v_acct.available,
    'credit_purchase', v_row.id::text, 'Sociva Credits added'
  );

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = v_row.seller_id;
  PERFORM public.seller_credit_notify(
    v_row.seller_id,
    'seller_credit_purchased',
    'Sociva Credits added',
    '₹' || trim(to_char(v_row.amount, 'FM999999990.00')) || ' Sociva Credits added successfully.'
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'purchase_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_seller_credit_purchase(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.seller_credit_purchases
  SET status = 'failed', updated_at = now()
  WHERE id = p_purchase_id AND status = 'created';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_summary(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_seller_ids IS NULL OR array_length(p_seller_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp ON sp.id = requested.id AND sp.user_id = v_uid
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  PERFORM public.seller_credit_ensure_account(sid)
  FROM unnest(p_seller_ids) sid;

  RETURN (
    SELECT jsonb_build_object(
      'available', COALESCE(SUM(a.available), 0),
      'reserved', COALESCE(SUM(a.reserved), 0),
      'lifetime_purchased', COALESCE(SUM(a.lifetime_purchased), 0),
      'lifetime_consumed', COALESCE(SUM(a.lifetime_consumed), 0),
      'lifetime_adjusted', COALESCE(SUM(a.lifetime_adjusted), 0),
      'used_this_month', COALESCE((
        SELECT SUM(ABS(l.charged_amount))
        FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids)
          AND l.type = 'event_charge'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'orders_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'ORDER_COMPLETED'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'enquiries_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'ENQUIRY_CREATED'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'bookings_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'SERVICE_BOOKING'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'contacts_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'CONTACT_REQUEST'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'spend_enabled', public.seller_credit_flag_enabled('seller_credit_spend_enabled'),
      'purchase_enabled', public.seller_credit_flag_enabled('seller_credit_purchase_enabled')
    )
    FROM public.seller_credit_accounts a
    WHERE a.seller_id = ANY(p_seller_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_activity(
  p_seller_ids uuid[],
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp ON sp.id = requested.id AND sp.user_id = v_uid
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC)
    FROM (
      SELECT *
      FROM public.seller_credit_ledger
      WHERE seller_id = ANY(p_seller_ids)
      ORDER BY created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) l
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_seller_billing_rule(
  p_event_type text,
  p_amount numeric,
  p_enabled boolean,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.seller_billing_rules;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'amount must be >= 0';
  END IF;
  SELECT * INTO v_old FROM public.seller_billing_rules WHERE event_type = p_event_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown billing event';
  END IF;
  UPDATE public.seller_billing_rules
  SET amount = p_amount,
      enabled = COALESCE(p_enabled, enabled),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE event_type = p_event_type;
  INSERT INTO public.seller_billing_rule_audit(
    event_type, old_amount, new_amount, old_enabled, new_enabled, reason, admin_id
  ) VALUES (
    p_event_type, v_old.amount, p_amount, v_old.enabled, COALESCE(p_enabled, v_old.enabled),
    NULLIF(trim(p_reason), ''), auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_seller_credits(
  p_seller_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct public.seller_credit_accounts;
  v_old_health text;
  v_health text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'adjustment amount cannot be zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_old_health := v_acct.last_health;
  IF p_amount < 0 AND v_acct.available < ABS(p_amount) THEN
    RAISE EXCEPTION 'adjustment would make the credit balance negative';
  END IF;
  UPDATE public.seller_credit_accounts
  SET available = available + p_amount,
      lifetime_adjusted = lifetime_adjusted + p_amount,
      updated_at = now()
  WHERE seller_id = p_seller_id
  RETURNING * INTO v_acct;
  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, description, created_by
  ) VALUES (
    p_seller_id, 'admin_adjustment', p_amount, ABS(p_amount), p_amount, v_acct.available,
    'admin_adjustment', p_reason, auth.uid()
  );
  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = p_seller_id;
  PERFORM public.seller_credit_maybe_notify_health(p_seller_id, v_old_health, v_health, v_acct.available);
  RETURN jsonb_build_object('ok', true, 'available', v_acct.available);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x))
    FROM (
      SELECT
        sp.id AS seller_id,
        sp.business_name,
        COALESCE(a.available, 0) AS available,
        COALESCE(a.reserved, 0) AS reserved,
        COALESCE(a.lifetime_purchased, 0) AS lifetime_purchased,
        COALESCE(a.lifetime_consumed, 0) AS lifetime_consumed,
        (
          SELECT max(p.created_at)
          FROM public.seller_credit_purchases p
          WHERE p.seller_id = sp.id AND p.status = 'captured'
        ) AS last_recharge_at,
        (
          SELECT max(l.created_at)
          FROM public.seller_credit_ledger l
          WHERE l.seller_id = sp.id
        ) AS last_activity_at
      FROM public.seller_profiles sp
      LEFT JOIN public.seller_credit_accounts a ON a.seller_id = sp.id
      ORDER BY sp.business_name
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_seller_credit_flag(p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_key NOT IN ('seller_credit_purchase_enabled', 'seller_credit_spend_enabled') THEN
    RAISE EXCEPTION 'unknown credit flag';
  END IF;
  UPDATE public.financial_feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_enquiry_atomic(
  p_seller_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_message text,
  p_action_title text,
  p_price numeric DEFAULT 0,
  p_listing_type text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_seller_user uuid;
  v_order uuid;
  v_txn text;
  v_gate jsonb;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_seller_user IS NULL THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  v_gate := public.seller_credit_can_accept(p_seller_id, 'ENQUIRY_CREATED');
  IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_gate->>'reason';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order
    FROM public.orders
    WHERE buyer_id = v_buyer AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_order IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'order_id', v_order, 'idempotent', true);
    END IF;
  END IF;

  v_txn := public.resolve_enquiry_transaction_type(p_listing_type);

  INSERT INTO public.orders(
    buyer_id, seller_id, total_amount, order_type, status, transaction_type, notes, idempotency_key
  ) VALUES (
    v_buyer, p_seller_id, COALESCE(p_price, 0), 'enquiry', 'enquired', v_txn,
    COALESCE(p_action_title, 'Request') || ' for: ' || COALESCE(p_product_name, 'listing') || E'\n\n' || COALESCE(p_message, ''),
    p_idempotency_key
  )
  RETURNING id INTO v_order;

  INSERT INTO public.order_items(order_id, product_id, product_name, quantity, unit_price)
  VALUES (v_order, p_product_id, COALESCE(p_product_name, 'listing'), 1, COALESCE(p_price, 0));

  INSERT INTO public.chat_messages(order_id, sender_id, receiver_id, message_text)
  VALUES (
    v_order, v_buyer, v_seller_user,
    'Hi! I would like to ' || lower(COALESCE(p_action_title, 'request')) || ' for "' || COALESCE(p_product_name, 'listing') || '".' || E'\n\n' || COALESCE(p_message, '')
  );

  RETURN jsonb_build_object('ok', true, 'order_id', v_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_seller_contact_interaction(
  p_seller_id uuid,
  p_product_id uuid,
  p_interaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_id uuid;
  v_gate jsonb;
  v_recent uuid;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_interaction_type NOT IN ('call', 'message') THEN
    RAISE EXCEPTION 'invalid interaction type';
  END IF;

  v_gate := public.seller_credit_can_accept(p_seller_id, 'CONTACT_REQUEST');
  IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_gate->>'reason';
  END IF;

  INSERT INTO public.seller_contact_interactions(buyer_id, seller_id, product_id, interaction_type)
  VALUES (v_buyer, p_seller_id, p_product_id, p_interaction_type)
  RETURNING id INTO v_id;

  SELECT l.reference_id INTO v_recent
  FROM public.seller_credit_ledger l
  WHERE l.seller_id = p_seller_id
    AND l.type = 'event_charge'
    AND l.event_type = 'CONTACT_REQUEST'
    AND l.metadata->>'buyer_id' = v_buyer::text
    AND l.metadata->>'product_id' = p_product_id::text
    AND l.created_at >= now() - interval '24 hours'
  LIMIT 1;

  IF v_recent IS NULL THEN
    BEGIN
      PERFORM public.record_seller_billable_event(
        p_seller_id, 'CONTACT_REQUEST', 'contact', v_id::text, 'charge',
        'Contact request', v_buyer
      );
      UPDATE public.seller_credit_ledger
      SET metadata = jsonb_build_object('buyer_id', v_buyer, 'product_id', p_product_id, 'interaction_type', p_interaction_type)
      WHERE seller_id = p_seller_id
        AND type = 'event_charge'
        AND event_type = 'CONTACT_REQUEST'
        AND reference_id = v_id::text;
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'SELLER_CREDIT_INSUFFICIENT%' THEN
        DELETE FROM public.seller_contact_interactions WHERE id = v_id;
        RAISE;
      END IF;
      RAISE;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'interaction_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seller_credit_can_accept(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_flag_enabled(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_seller_credit_purchase(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_seller_credit_provider_order(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_seller_credit_purchase(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_credit_summary(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_credit_activity(uuid[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_seller_billing_rule(text, numeric, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credits() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_seller_credit_flag(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_enquiry_atomic(uuid, uuid, text, text, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_seller_contact_interaction(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_seller_billable_event(uuid, text, text, text, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_seller_billable_event(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_seller_credit_provider_order(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.seller_credit_accounts IS
  'Prepaid Sociva Credits per store. Opposite direction from seller_settlements. Welcome credits = 0.';
