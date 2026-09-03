-- orders.payment_type is the canonical column. Refund RPCs were written with
-- COALESCE(o.payment_type, o.payment_method, ''), which fails at parse time
-- because payment_method does not exist on public.orders (42703).

CREATE OR REPLACE FUNCTION public.is_order_online_payment_source(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pm text;
BEGIN
  SELECT lower(trim(COALESCE(o.payment_type, '')))
  INTO v_pm
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_pm = '' THEN
    RETURN false;
  END IF;

  IF v_pm IN ('cod', 'cash') THEN
    RETURN false;
  END IF;

  RETURN v_pm IN (
    'wallet', 'online', 'upi', 'razorpay', 'card',
    'upi_deep_link', 'prepaid'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sociva_balance_refund_eligibility(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
  v_wallet_flag boolean := false;
  v_online_platform boolean;
  v_online_order boolean;
  v_pm text;
  v_eligible boolean := false;
  v_reason text;
  v_message text;
BEGIN
  v_mode := public.get_public_payment_mode();
  v_online_platform := v_mode <> 'off';

  SELECT COALESCE(enabled, false) INTO v_wallet_flag
  FROM public.financial_feature_flags
  WHERE key = 'wallet_refund_credit_enabled';

  SELECT lower(trim(COALESCE(o.payment_type, '')))
  INTO v_pm
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'ORDER_NOT_FOUND',
      'message', 'Order not found',
      'payment_gateway_mode', v_mode,
      'payment_method', null,
      'refund_destination', null
    );
  END IF;

  v_online_order := public.is_order_online_payment_source(p_order_id);

  IF NOT v_online_platform THEN
    v_reason := 'PLATFORM_ONLINE_DISABLED';
    v_message := 'Online payment refunds are unavailable while the platform is in COD-only mode.';
  ELSIF NOT COALESCE(v_wallet_flag, false) THEN
    v_reason := 'WALLET_REFUND_FLAG_DISABLED';
    v_message := 'Sociva Balance refunds are temporarily disabled.';
  ELSIF NOT v_online_order THEN
    v_reason := 'COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND';
    v_message := 'Sociva Balance refunds are not available for Cash on Delivery orders.';
  ELSE
    v_eligible := true;
    v_reason := 'ONLINE_PAYMENT_SUPPORTED';
    v_message := 'Seller may approve a refund as Sociva Balance for this online-paid order.';
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'reason', v_reason,
    'message', v_message,
    'payment_gateway_mode', v_mode,
    'payment_method', v_pm,
    'online_platform_enabled', v_online_platform,
    'wallet_refund_credit_enabled', COALESCE(v_wallet_flag, false),
    'refund_destination', CASE WHEN v_eligible THEN 'wallet' ELSE null END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.is_order_online_payment_source(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_order_online_payment_source(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_sociva_balance_refund_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sociva_balance_refund_eligibility(uuid) TO authenticated, service_role;

-- Patch any remaining functions that still SELECT o.payment_method from orders.
DO $$
DECLARE
  rec record;
  def text;
  patched text;
  n_patched int := 0;
BEGIN
  FOR rec IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'finance')
      AND p.prokind = 'f'
      AND position('o.payment_method' in pg_get_functiondef(p.oid)) > 0
  LOOP
    def := pg_get_functiondef(rec.oid);
    patched := replace(
      def,
      'COALESCE(o.payment_type, o.payment_method, '''')',
      'COALESCE(o.payment_type, '''')'
    );
    IF patched IS DISTINCT FROM def THEN
      EXECUTE patched;
      n_patched := n_patched + 1;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'finance')
      AND p.prokind = 'f'
      AND position('o.payment_method' in pg_get_functiondef(p.oid)) > 0
  ) THEN
    RAISE EXCEPTION 'o.payment_method still referenced after orders.payment_type patch';
  END IF;

  RAISE NOTICE 'patched % function(s) that referenced o.payment_method', n_patched;
END $$;
