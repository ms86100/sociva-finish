-- ============================================================
-- P0: Seller cancel auto-refund correctness (failure_owner)
-- P1: checkout_groups parent purchase model + order FK
-- P3 hooks: razorpay fields on checkout_groups
-- ============================================================

-- ------------------------------------------------------------
-- 1. checkout_groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL,
  payment_method text,
  payment_status text NOT NULL DEFAULT 'pending',
  fulfillment_type text,
  total_amount numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0,
  coupon_discount numeric NOT NULL DEFAULT 0,
  loyalty_discount_amount numeric NOT NULL DEFAULT 0,
  wallet_cash_amount numeric NOT NULL DEFAULT 0,
  wallet_promo_amount numeric NOT NULL DEFAULT 0,
  razorpay_order_id text,
  razorpay_payment_id text,
  -- Shared checkout idempotency prefix (without :N). Null for singleton groups.
  idempotency_key text,
  order_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_groups_idempotency_key
  ON public.checkout_groups (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_groups_buyer_created
  ON public.checkout_groups (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_groups_razorpay_payment
  ON public.checkout_groups (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

ALTER TABLE public.checkout_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers can view own checkout groups" ON public.checkout_groups;
CREATE POLICY "Buyers can view own checkout groups"
  ON public.checkout_groups FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Service role full access on checkout_groups" ON public.checkout_groups;
CREATE POLICY "Service role full access on checkout_groups"
  ON public.checkout_groups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_update_updated_at_checkout_groups ON public.checkout_groups;
CREATE TRIGGER trg_update_updated_at_checkout_groups
  BEFORE UPDATE ON public.checkout_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. orders.checkout_group_id
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_group_id uuid REFERENCES public.checkout_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_checkout_group_id
  ON public.orders (checkout_group_id)
  WHERE checkout_group_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Refresh checkout group aggregates from child orders
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_checkout_group_totals(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _group_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.checkout_groups cg
  SET
    order_count = COALESCE(agg.cnt, 0),
    total_amount = COALESCE(agg.total_amount, 0),
    delivery_fee = COALESCE(agg.delivery_fee, 0),
    coupon_discount = COALESCE(agg.coupon_discount, 0),
    loyalty_discount_amount = COALESCE(agg.loyalty_discount_amount, 0),
    wallet_cash_amount = COALESCE(agg.wallet_cash_amount, 0),
    wallet_promo_amount = COALESCE(agg.wallet_promo_amount, 0),
    payment_method = COALESCE(agg.payment_type, cg.payment_method),
    fulfillment_type = COALESCE(agg.fulfillment_type, cg.fulfillment_type),
    society_id = COALESCE(cg.society_id, agg.society_id),
    -- Group payment_status: paid if any child paid; else most common / first
    payment_status = CASE
      WHEN COALESCE(agg.paid_cnt, 0) > 0
        AND COALESCE(agg.paid_cnt, 0) = COALESCE(agg.cnt, 0) THEN 'paid'
      WHEN COALESCE(agg.paid_cnt, 0) > 0 THEN 'partially_paid'
      WHEN COALESCE(agg.refunded_cnt, 0) > 0
        AND COALESCE(agg.refunded_cnt, 0) = COALESCE(agg.cnt, 0) THEN 'refunded'
      WHEN COALESCE(agg.refund_cnt, 0) > 0 THEN 'refund_initiated'
      ELSE COALESCE(agg.any_payment_status, cg.payment_status, 'pending')
    END,
    razorpay_order_id = COALESCE(cg.razorpay_order_id, agg.razorpay_order_id),
    razorpay_payment_id = COALESCE(cg.razorpay_payment_id, agg.razorpay_payment_id),
    updated_at = now()
  FROM (
    SELECT
      count(*)::int AS cnt,
      sum(COALESCE(o.total_amount, 0)) AS total_amount,
      sum(COALESCE(o.delivery_fee, 0)) AS delivery_fee,
      sum(COALESCE(o.coupon_discount, 0)) AS coupon_discount,
      sum(COALESCE(o.loyalty_discount_amount, 0)) AS loyalty_discount_amount,
      sum(COALESCE(o.wallet_cash_amount, 0)) AS wallet_cash_amount,
      sum(COALESCE(o.wallet_promo_amount, 0)) AS wallet_promo_amount,
      count(*) FILTER (
        WHERE o.payment_status IN ('paid', 'seller_verified', 'completed')
      )::int AS paid_cnt,
      count(*) FILTER (
        WHERE o.payment_status IN ('refund_initiated', 'refund_processing', 'refunded')
      )::int AS refund_cnt,
      count(*) FILTER (WHERE o.payment_status = 'refunded')::int AS refunded_cnt,
      (array_agg(o.payment_type ORDER BY o.created_at))[1] AS payment_type,
      (array_agg(o.fulfillment_type ORDER BY o.created_at))[1] AS fulfillment_type,
      (array_agg(o.society_id ORDER BY o.created_at))[1] AS society_id,
      (array_agg(o.payment_status ORDER BY o.created_at))[1] AS any_payment_status,
      (array_agg(o.razorpay_order_id ORDER BY o.created_at)
        FILTER (WHERE o.razorpay_order_id IS NOT NULL))[1] AS razorpay_order_id,
      (array_agg(o.razorpay_payment_id ORDER BY o.created_at)
        FILTER (WHERE o.razorpay_payment_id IS NOT NULL))[1] AS razorpay_payment_id
    FROM public.orders o
    WHERE o.checkout_group_id = _group_id
  ) agg
  WHERE cg.id = _group_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_checkout_group_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_checkout_group_totals(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_checkout_group_totals(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. Assign checkout_group on order insert (CMVO + other paths)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_orders_assign_checkout_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_group_id uuid;
  v_society_id uuid;
BEGIN
  IF NEW.checkout_group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_society_id := NEW.society_id;
  IF v_society_id IS NULL THEN
    SELECT p.society_id INTO v_society_id
    FROM public.profiles p
    WHERE p.id = NEW.buyer_id;
  END IF;

  -- Multi-seller soft link: idempotency_key = checkoutKey:N
  IF NEW.idempotency_key IS NOT NULL AND position(':' IN NEW.idempotency_key) > 0 THEN
    v_prefix := regexp_replace(NEW.idempotency_key, ':[^:]*$', '');

    SELECT cg.id INTO v_group_id
    FROM public.checkout_groups cg
    WHERE cg.idempotency_key = v_prefix
      AND cg.buyer_id = NEW.buyer_id
    FOR UPDATE;

    IF v_group_id IS NULL THEN
      INSERT INTO public.checkout_groups (
        buyer_id,
        society_id,
        payment_method,
        payment_status,
        fulfillment_type,
        idempotency_key,
        order_count
      ) VALUES (
        NEW.buyer_id,
        v_society_id,
        NEW.payment_type,
        COALESCE(NEW.payment_status, 'pending'),
        NEW.fulfillment_type,
        v_prefix,
        0
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET updated_at = now()
      RETURNING id INTO v_group_id;

      IF v_group_id IS NULL THEN
        SELECT cg.id INTO v_group_id
        FROM public.checkout_groups cg
        WHERE cg.idempotency_key = v_prefix;
      END IF;
    END IF;
  ELSE
    -- Singleton purchase group (one order = one checkout group)
    INSERT INTO public.checkout_groups (
      buyer_id,
      society_id,
      payment_method,
      payment_status,
      fulfillment_type,
      idempotency_key,
      order_count
    ) VALUES (
      NEW.buyer_id,
      v_society_id,
      NEW.payment_type,
      COALESCE(NEW.payment_status, 'pending'),
      NEW.fulfillment_type,
      NULL,
      0
    )
    RETURNING id INTO v_group_id;
  END IF;

  NEW.checkout_group_id := v_group_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_assign_checkout_group ON public.orders;
CREATE TRIGGER trg_orders_assign_checkout_group
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_orders_assign_checkout_group();

CREATE OR REPLACE FUNCTION public.fn_orders_refresh_checkout_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.checkout_group_id IS NOT NULL THEN
      PERFORM public.refresh_checkout_group_totals(NEW.checkout_group_id);
    END IF;
    IF OLD.checkout_group_id IS NOT NULL
       AND OLD.checkout_group_id IS DISTINCT FROM NEW.checkout_group_id THEN
      PERFORM public.refresh_checkout_group_totals(OLD.checkout_group_id);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.checkout_group_id IS NOT NULL THEN
      PERFORM public.refresh_checkout_group_totals(NEW.checkout_group_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.checkout_group_id IS NOT NULL THEN
      PERFORM public.refresh_checkout_group_totals(OLD.checkout_group_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_refresh_checkout_group ON public.orders;
CREATE TRIGGER trg_orders_refresh_checkout_group
  AFTER INSERT OR DELETE OR UPDATE OF
    checkout_group_id, total_amount, delivery_fee, coupon_discount,
    loyalty_discount_amount, wallet_cash_amount, wallet_promo_amount,
    payment_status, payment_type, razorpay_order_id, razorpay_payment_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_orders_refresh_checkout_group();

