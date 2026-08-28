-- Sociva Credit refunds end-to-end: wallet path, seller_respond_refund (full/partial/reject/info),
-- buyer refund-risk scoring, nightly recompute + prior calibration hooks.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS requested_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_amount numeric,
  ADD COLUMN IF NOT EXISTS seller_decision text;

COMMENT ON COLUMN public.refund_requests.requested_amount IS 'Original buyer-requested amount (immutable after create).';
COMMENT ON COLUMN public.refund_requests.approved_amount IS 'Seller/admin approved settlement amount (may be partial).';
COMMENT ON COLUMN public.refund_requests.seller_decision IS 'approve_full | approve_partial | reject | request_info';

UPDATE public.refund_requests
SET requested_amount = amount
WHERE requested_amount IS NULL AND amount IS NOT NULL;

-- ── Enable wallet refund credit (migration-approved) ─────────────────────────
DO $$
BEGIN
  PERFORM set_config('app.financial_control_approved', 'true', true);
  UPDATE public.financial_feature_flags
  SET enabled = true,
      updated_at = now(),
      description = COALESCE(description, '') || ' | enabled for Sociva Credit dispute refunds'
  WHERE key = 'wallet_refund_credit_enabled'
    AND enabled IS DISTINCT FROM true;
END $$;

-- Risk model settings (tunable)
INSERT INTO public.system_settings (key, value)
VALUES
  ('refund_risk_alpha0', '2'),
  ('refund_risk_beta0', '48'),
  ('refund_risk_band_low_max', '34'),
  ('refund_risk_band_medium_max', '64'),
  ('refund_risk_calibrate_min_orders', '500')
ON CONFLICT (key) DO NOTHING;

-- ── Snapshots ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buyer_refund_risk_snapshots (
  buyer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  orders_n integer NOT NULL DEFAULT 0,
  refunds_k integer NOT NULL DEFAULT 0,
  refunds_granted_g integer NOT NULL DEFAULT 0,
  gmv numeric NOT NULL DEFAULT 0,
  refund_value numeric NOT NULL DEFAULT 0,
  refunds_30d integer NOT NULL DEFAULT 0,
  orders_30d integer NOT NULL DEFAULT 0,
  posterior_mu numeric NOT NULL DEFAULT 0,
  wilson_u numeric NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  band text NOT NULL DEFAULT 'low'
    CHECK (band IN ('low', 'medium', 'high')),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.buyer_refund_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  band text NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_refund_risk_events_buyer_created
  ON public.buyer_refund_risk_events (buyer_id, created_at DESC);

ALTER TABLE public.buyer_refund_risk_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_refund_risk_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sellers_read_buyer_risk_for_own_orders" ON public.buyer_refund_risk_snapshots;
CREATE POLICY "sellers_read_buyer_risk_for_own_orders"
  ON public.buyer_refund_risk_snapshots FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE o.buyer_id = buyer_refund_risk_snapshots.buyer_id
        AND sp.user_id = auth.uid()
    )
    OR buyer_id = auth.uid()
  );

DROP POLICY IF EXISTS "admins_read_risk_events" ON public.buyer_refund_risk_events;
CREATE POLICY "admins_read_risk_events"
  ON public.buyer_refund_risk_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

GRANT SELECT ON public.buyer_refund_risk_snapshots TO authenticated;
GRANT SELECT ON public.buyer_refund_risk_events TO authenticated;
GRANT ALL ON public.buyer_refund_risk_snapshots TO service_role;
GRANT ALL ON public.buyer_refund_risk_events TO service_role;

-- ── Helpers: Wilson upper bound ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wilson_upper_bound(p_k numeric, p_n numeric, p_z numeric DEFAULT 1.96)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  phat numeric;
  z2 numeric;
  denom numeric;
  centre numeric;
  margin numeric;
BEGIN
  IF p_n IS NULL OR p_n <= 0 THEN
    RETURN 0;
  END IF;
  phat := GREATEST(0, LEAST(1, COALESCE(p_k, 0) / p_n));
  z2 := p_z * p_z;
  denom := 1 + z2 / p_n;
  centre := (phat + z2 / (2 * p_n)) / denom;
  margin := (p_z * sqrt((phat * (1 - phat) / p_n) + (z2 / (4 * p_n * p_n)))) / denom;
  RETURN GREATEST(0, LEAST(1, centre + margin));
END;
$$;

-- ── Recompute one buyer ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_buyer_refund_risk(p_buyer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alpha numeric;
  v_beta numeric;
  v_low_max numeric;
  v_med_max numeric;
  v_n integer := 0;
  v_k integer := 0;
  v_g integer := 0;
  v_gmv numeric := 0;
  v_rv numeric := 0;
  v_k30 integer := 0;
  v_n30 integer := 0;
  v_mu numeric;
  v_u numeric;
  v_r30 numeric := 0;
  v_c_rate numeric := 0;
  v_c_vol numeric := 0;
  v_c_val numeric := 0;
  v_c_rec numeric := 0;
  v_c_pat numeric := 0;
  v_c_dis numeric := 0;
  v_score numeric := 0;
  v_band text := 'low';
  v_rec text;
  v_features jsonb;
  v_cohort_mu numeric;
  v_cohort_n integer;
  v_above_cohort boolean := false;
  v_cal_min integer;
  v_platform_orders bigint;
  v_old_band text;
  v_old_score numeric;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::numeric, 2) INTO v_alpha
  FROM public.system_settings WHERE key = 'refund_risk_alpha0';
  IF v_alpha IS NULL THEN v_alpha := 2; END IF;

  SELECT COALESCE(NULLIF(value, '')::numeric, 48) INTO v_beta
  FROM public.system_settings WHERE key = 'refund_risk_beta0';
  IF v_beta IS NULL THEN v_beta := 48; END IF;

  SELECT COALESCE(NULLIF(value, '')::numeric, 34) INTO v_low_max
  FROM public.system_settings WHERE key = 'refund_risk_band_low_max';
  IF v_low_max IS NULL THEN v_low_max := 34; END IF;

  SELECT COALESCE(NULLIF(value, '')::numeric, 64) INTO v_med_max
  FROM public.system_settings WHERE key = 'refund_risk_band_medium_max';
  IF v_med_max IS NULL THEN v_med_max := 64; END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 500) INTO v_cal_min
  FROM public.system_settings WHERE key = 'refund_risk_calibrate_min_orders';
  IF v_cal_min IS NULL THEN v_cal_min := 500; END IF;

  -- Auto-calibrate prior mean toward platform p50 when volume exists
  SELECT COUNT(*) INTO v_platform_orders
  FROM public.orders
  WHERE status NOT IN ('payment_pending')
    AND COALESCE(payment_status, '') NOT IN ('pending');

  IF v_platform_orders >= v_cal_min THEN
    SELECT COALESCE(
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY rate),
      v_alpha / (v_alpha + v_beta)
    ) INTO v_mu
    FROM (
      SELECT
        (COUNT(r.id)::numeric / NULLIF(COUNT(DISTINCT o.id), 0)) AS rate
      FROM public.orders o
      LEFT JOIN public.refund_requests r ON r.order_id = o.id
      WHERE o.status NOT IN ('payment_pending')
        AND COALESCE(o.payment_status, '') NOT IN ('pending')
      GROUP BY o.buyer_id
      HAVING COUNT(DISTINCT o.id) >= 5
    ) s;
    IF v_mu IS NOT NULL AND v_mu > 0 AND v_mu < 1 THEN
      -- Keep prior strength 50; set alpha/beta to match calibrated mean
      v_alpha := GREATEST(0.5, v_mu * 50);
      v_beta := GREATEST(0.5, (1 - v_mu) * 50);
    END IF;
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(o.total_amount), 0),
    COUNT(*) FILTER (WHERE o.created_at >= now() - interval '30 days')::integer
  INTO v_n, v_gmv, v_n30
  FROM public.orders o
  WHERE o.buyer_id = p_buyer_id
    AND o.status NOT IN ('payment_pending')
    AND COALESCE(o.payment_status, '') NOT IN ('pending');

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (
      WHERE r.refund_state IN ('approved', 'refund_initiated', 'refund_processing', 'refund_completed')
         OR r.status IN ('approved', 'settled', 'completed', 'auto_approved')
    )::integer,
    COALESCE(SUM(COALESCE(r.requested_amount, r.amount)), 0),
    COUNT(*) FILTER (WHERE r.created_at >= now() - interval '30 days')::integer
  INTO v_k, v_g, v_rv, v_k30
  FROM public.refund_requests r
  WHERE r.buyer_id = p_buyer_id;

  v_mu := (v_alpha + v_k) / NULLIF(v_alpha + v_beta + v_n, 0);
  IF v_mu IS NULL THEN v_mu := v_alpha / (v_alpha + v_beta); END IF;
  v_u := public.wilson_upper_bound(v_k::numeric, GREATEST(v_n, 1)::numeric, 1.96);
  IF v_n30 > 0 THEN
    v_r30 := v_k30::numeric / v_n30;
  END IF;

  -- Rate (30%)
  v_c_rate := LEAST(100, 100 * (v_u / 0.25));

  -- Volume vs n (15%)
  IF v_n < 8 THEN
    v_c_vol := LEAST(100, 100 * (v_k::numeric / GREATEST(v_n, 1)));
  ELSIF v_k >= 4 THEN
    v_c_vol := LEAST(100, 20 * ln(1 + v_k));
  ELSE
    v_c_vol := 0;
  END IF;

  -- Value (15%)
  IF v_gmv > 0 THEN
    v_c_val := LEAST(100, 100 * (v_rv / v_gmv));
  ELSE
    v_c_val := 0;
  END IF;

  -- Recency (20%)
  IF v_n30 >= 2 THEN
    v_c_rec := LEAST(100, 100 * GREATEST(0, v_r30 - v_mu) / 0.20);
  ELSE
    v_c_rec := 0;
  END IF;

  -- Pattern (10%): same category ≥3
  SELECT CASE WHEN COUNT(*) >= 1 THEN 40 ELSE 0 END INTO v_c_pat
  FROM (
    SELECT category, COUNT(*) AS c
    FROM public.refund_requests
    WHERE buyer_id = p_buyer_id
    GROUP BY category
    HAVING COUNT(*) >= 3
  ) cats;
  v_c_pat := COALESCE(v_c_pat, 0);

  -- Dispute integrity (10%)
  IF v_k > 0 AND (v_g::numeric / v_k) >= 0.8 THEN
    v_c_dis := -50; -- protect buyers whose refunds were mostly granted
  ELSIF EXISTS (
    SELECT 1 FROM public.refund_requests
    WHERE buyer_id = p_buyer_id AND refund_state = 'rejected'
    HAVING COUNT(*) >= 2
  ) THEN
    v_c_dis := 20;
  ELSE
    v_c_dis := 0;
  END IF;

  -- Cohort comparison (Phase D): same order-volume bucket
  SELECT AVG(s.posterior_mu), COUNT(*)::integer
  INTO v_cohort_mu, v_cohort_n
  FROM public.buyer_refund_risk_snapshots s
  WHERE s.buyer_id <> p_buyer_id
    AND (
      (v_n BETWEEN 1 AND 4 AND s.orders_n BETWEEN 1 AND 4)
      OR (v_n BETWEEN 5 AND 19 AND s.orders_n BETWEEN 5 AND 19)
      OR (v_n BETWEEN 20 AND 49 AND s.orders_n BETWEEN 20 AND 49)
      OR (v_n >= 50 AND s.orders_n >= 50)
    );
  IF COALESCE(v_cohort_n, 0) >= 30 AND v_cohort_mu IS NOT NULL AND v_mu > v_cohort_mu + 0.05 THEN
    v_above_cohort := true;
    v_c_rate := LEAST(100, v_c_rate + 15);
  END IF;

  v_score := GREATEST(0, LEAST(100,
    0.30 * v_c_rate + 0.15 * v_c_vol + 0.15 * v_c_val
    + 0.20 * v_c_rec + 0.10 * v_c_pat + 0.10 * GREATEST(v_c_dis, 0)
    + CASE WHEN v_c_dis < 0 THEN v_c_dis * 0.10 ELSE 0 END
  ));

  -- Cold-start guards
  IF v_n < 3 AND v_k < 2 THEN
    v_band := 'low';
    v_score := LEAST(v_score, v_low_max);
  ELSIF v_n < 4 AND v_k < 3 AND v_score >= v_med_max THEN
    v_band := 'medium';
    v_score := v_med_max;
  ELSIF v_score <= v_low_max THEN
    v_band := 'low';
  ELSIF v_score <= v_med_max THEN
    v_band := 'medium';
  ELSE
    v_band := 'high';
  END IF;

  IF v_band = 'low' THEN
    v_rec := 'Likely genuine customer complaint. History is consistent with normal behaviour.';
  ELSIF v_band = 'medium' THEN
    v_rec := 'Review carefully. This buyer requests refunds more often than typical — consider chatting before approving.';
  ELSE
    v_rec := 'Potential refund abuse — review the order carefully before issuing a refund.';
  END IF;

  SELECT s.band, s.score INTO v_old_band, v_old_score
  FROM public.buyer_refund_risk_snapshots s
  WHERE s.buyer_id = p_buyer_id;

  v_features := jsonb_build_object(
    'orders_n', v_n,
    'refunds_k', v_k,
    'refunds_granted_g', v_g,
    'refund_rate', CASE WHEN v_n > 0 THEN ROUND((v_k::numeric / v_n)::numeric, 4) ELSE 0 END,
    'gmv', v_gmv,
    'refund_value', v_rv,
    'refunds_30d', v_k30,
    'orders_30d', v_n30,
    'posterior_mu', ROUND(v_mu::numeric, 4),
    'wilson_u', ROUND(v_u::numeric, 4),
    'components', jsonb_build_object(
      'rate', ROUND(v_c_rate::numeric, 1),
      'volume', ROUND(v_c_vol::numeric, 1),
      'value', ROUND(v_c_val::numeric, 1),
      'recency', ROUND(v_c_rec::numeric, 1),
      'pattern', ROUND(v_c_pat::numeric, 1),
      'dispute', ROUND(v_c_dis::numeric, 1)
    ),
    'above_cohort', v_above_cohort,
    'cohort_n', COALESCE(v_cohort_n, 0),
    'prior_alpha', v_alpha,
    'prior_beta', v_beta
  );

  INSERT INTO public.buyer_refund_risk_snapshots AS s (
    buyer_id, orders_n, refunds_k, refunds_granted_g, gmv, refund_value,
    refunds_30d, orders_30d, posterior_mu, wilson_u, score, band, features,
    recommendation, computed_at, updated_at
  ) VALUES (
    p_buyer_id, v_n, v_k, v_g, v_gmv, v_rv,
    v_k30, v_n30, v_mu, v_u, ROUND(v_score::numeric, 1), v_band, v_features,
    v_rec, now(), now()
  )
  ON CONFLICT (buyer_id) DO UPDATE SET
    orders_n = EXCLUDED.orders_n,
    refunds_k = EXCLUDED.refunds_k,
    refunds_granted_g = EXCLUDED.refunds_granted_g,
    gmv = EXCLUDED.gmv,
    refund_value = EXCLUDED.refund_value,
    refunds_30d = EXCLUDED.refunds_30d,
    orders_30d = EXCLUDED.orders_30d,
    posterior_mu = EXCLUDED.posterior_mu,
    wilson_u = EXCLUDED.wilson_u,
    score = EXCLUDED.score,
    band = EXCLUDED.band,
    features = EXCLUDED.features,
    recommendation = EXCLUDED.recommendation,
    computed_at = now(),
    updated_at = now();

  INSERT INTO public.buyer_refund_risk_events (buyer_id, score, band, features, reason)
  SELECT p_buyer_id, ROUND(v_score::numeric, 1), v_band, v_features, 'recompute'
  WHERE v_old_band IS NULL
     OR v_old_band IS DISTINCT FROM v_band
     OR ABS(COALESCE(v_old_score, 0) - v_score) >= 5;

  RETURN jsonb_build_object(
    'buyer_id', p_buyer_id,
    'score', ROUND(v_score::numeric, 1),
    'band', v_band,
    'recommendation', v_rec,
    'features', v_features
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_buyer_refund_risk(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_buyer_refund_risk(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_buyer_refund_risk_profile(p_buyer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_allowed := public.is_admin(auth.uid())
    OR p_buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE o.buyer_id = p_buyer_id AND sp.user_id = auth.uid()
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'not allowed to view this buyer risk profile' USING ERRCODE = '42501';
  END IF;

  RETURN public.recompute_buyer_refund_risk(p_buyer_id);
END;
$function$;

-- Allow sellers/admins to call the profile RPC (internally recomputes)
REVOKE ALL ON FUNCTION public.get_buyer_refund_risk_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_buyer_refund_risk_profile(uuid) TO authenticated, service_role;
-- Also allow authenticated to run recompute via profile only; keep direct recompute service_role.
-- Fix: get_buyer_refund_risk_profile calls recompute which is service_role only — SECURITY DEFINER owner can still call it.

CREATE OR REPLACE FUNCTION public.recompute_all_buyer_refund_risks(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT buyer_id
    FROM public.orders
    WHERE created_at >= now() - interval '90 days'
      AND status NOT IN ('payment_pending')
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000)
  LOOP
    PERFORM public.recompute_buyer_refund_risk(r.buyer_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('recomputed', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_all_buyer_refund_risks(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_all_buyer_refund_risks(integer) TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'buyer_refund_risk_nightly'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'buyer_refund_risk_nightly',
  '20 2 * * *',
  $cron$ SELECT public.recompute_all_buyer_refund_risks(1000); $cron$
);

-- ── Wallet credit uses approved_amount ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.credit_wallet_from_refund(_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _amt numeric;
  _res jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'refund_not_found');
  END IF;

  _amt := ROUND(COALESCE(r.approved_amount, r.wallet_credit_amount, r.amount, 0)::numeric, 2);
  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'zero_amount');
  END IF;

  _res := public.credit_wallet_cash(
    r.buyer_id,
    _amt,
    'refund',
    'wallet-refund:' || r.id::text,
    r.id,
    r.order_id,
    'Refund credited as Sociva Credit (instant)'
  );

  UPDATE public.refund_requests
  SET wallet_credit_amount = _amt
  WHERE id = r.id AND wallet_credit_amount IS NULL;

  RETURN _res;
END;
$$;

-- ── complete_refund: settlement amount + partial clawback ────────────────────
CREATE OR REPLACE FUNCTION public.complete_refund(
  p_refund_id uuid,
  p_gateway_ref text,
  p_gateway_status text
)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_before text;
  o public.orders;
  _paid numeric;
  _frac numeric;
  _restore integer;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _notify_body text;
  v_refunded numeric;
  v_full boolean;
  v_settle numeric;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  v_settle := ROUND(COALESCE(r.approved_amount, r.amount, 0)::numeric, 2);

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  SELECT COALESCE(SUM(ROUND(COALESCE(rr.approved_amount, rr.amount, 0)::numeric, 2)), 0) INTO v_refunded
  FROM public.refund_requests rr
  WHERE rr.order_id = r.order_id
    AND rr.refund_state = 'refund_completed';

  SELECT * INTO o FROM public.orders WHERE id = r.order_id FOR UPDATE;
  v_full := ROUND(v_refunded, 2) >= ROUND(COALESCE(o.total_amount, 0), 2)
            AND COALESCE(o.total_amount, 0) > 0;

  UPDATE public.orders
  SET amount_refunded = ROUND(v_refunded, 2),
      payment_status = CASE WHEN v_full THEN 'refunded' ELSE payment_status END,
      updated_at = now()
  WHERE id = r.order_id;

  IF v_full THEN
    UPDATE public.payment_records
    SET payment_status = 'refunded'
    WHERE order_id = r.order_id
      AND payment_status IN ('paid', 'refund_initiated', 'refund_processing');
  END IF;

  UPDATE public.seller_settlements s
  SET net_amount = GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0),
      settlement_status = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0 THEN
          CASE WHEN s.settlement_status = 'settled' THEN 'disputed' ELSE 'on_hold' END
        ELSE s.settlement_status
      END,
      hold_reason = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0 THEN
          COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Order refunded (' || p_gateway_ref || ')'
        ELSE COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Partial refund ' || v_settle::text || ' (' || p_gateway_ref || ')'
      END,
      eligible_at = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0
          THEN NULL
        ELSE s.eligible_at
      END,
      updated_at = now()
  WHERE s.order_id = r.order_id
    AND s.settlement_status IN ('pending', 'eligible', 'processing', 'settled', 'on_hold');

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    IF o.checkout_group_id IS NOT NULL AND v_settle > 0 THEN
      UPDATE public.checkout_groups cg
      SET amount_refunded = ROUND(COALESCE(cg.amount_refunded, 0) + v_settle, 2),
          payment_status = CASE
            WHEN ROUND(COALESCE(cg.amount_refunded, 0) + v_settle, 2)
                 >= ROUND(COALESCE(cg.gateway_captured_amount, cg.total_amount, 0), 2)
              THEN 'refunded'
            ELSE 'partially_refunded'
          END,
          updated_at = now()
      WHERE cg.id = o.checkout_group_id;
    END IF;

    _paid := NULLIF(COALESCE(o.total_amount, 0) + COALESCE(o.wallet_cash_amount, 0) + COALESCE(o.wallet_promo_amount, 0) + COALESCE(o.loyalty_discount_amount, 0), 0);
    IF COALESCE(o.total_amount, 0) > 0 THEN
      _paid := o.total_amount;
    END IF;
    IF _paid IS NOT NULL AND v_settle > 0 THEN
      _frac := LEAST(GREATEST(v_settle / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;

    IF COALESCE(r.refund_destination, 'wallet') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'wallet') = 'wallet' THEN
    _notify_body := 'Your refund of ₹' || trim(to_char(v_settle, 'FM9999990.00'))
      || ' was credited instantly as Sociva Credit. Usable on Sociva only (not withdrawable).';
  ELSE
    _notify_body := 'Your refund of ₹' || trim(to_char(v_settle, 'FM9999990.00'))
      || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination,
            'approved_amount', v_settle,
            'full_order_refund', v_full,
            'order_amount_refunded', v_refunded
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, action_url, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination,
            'refund_amount', v_settle,
            'high_priority', true
          ));

  PERFORM public.recompute_buyer_refund_risk(r.buyer_id);

  RETURN r;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_refund(uuid, text, text) TO service_role;

-- ── seller_respond_refund: full / partial / reject / request_info ─────────────
CREATE OR REPLACE FUNCTION public.seller_respond_refund(
  p_refund_id uuid,
  p_action text,
  p_amount numeric DEFAULT NULL,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_seller_profile uuid;
  v_seller_user uuid;
  v_action text;
  v_cap numeric;
  v_approved numeric;
  v_decision text;
  v_ticket uuid;
  v_item_line text;
  v_before text;
  v_completed public.refund_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_action := lower(trim(COALESCE(p_action, '')));
  IF v_action NOT IN ('approve_full', 'approve_partial', 'reject', 'request_info') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;

  SELECT o.seller_id INTO v_seller_profile FROM public.orders o WHERE o.id = r.order_id;
  SELECT sp.user_id INTO v_seller_user FROM public.seller_profiles sp WHERE sp.id = v_seller_profile;

  IF v_seller_user IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the seller can respond to this refund' USING ERRCODE = '42501';
  END IF;

  IF v_action IN ('approve_full', 'approve_partial', 'reject') AND r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be actioned from state: %', r.refund_state;
  END IF;

  v_cap := ROUND(COALESCE(r.requested_amount, r.amount, 0)::numeric, 2);
  IF v_cap <= 0 THEN
    RAISE EXCEPTION 'Invalid refund cap';
  END IF;

  IF v_action = 'reject' THEN
    IF p_message IS NULL OR length(trim(p_message)) < 5 THEN
      RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
    END IF;

    UPDATE public.refund_requests
    SET refund_state = 'rejected',
        status = 'rejected',
        rejection_reason = trim(p_message),
        seller_decision = 'reject',
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;

    INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
    VALUES (p_refund_id, 'reject', auth.uid(), 'seller', v_before, 'rejected',
            jsonb_build_object('reason', trim(p_message)));

    INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
    VALUES (
      r.buyer_id,
      'Refund request declined',
      left('The seller declined your refund request. Reason: ' || trim(p_message), 240),
      'order',
      '/orders/' || r.order_id,
      jsonb_build_object(
        'orderId', r.order_id,
        'refundId', r.id,
        'status', 'refund_rejected',
        'target_role', 'buyer',
        'high_priority', true
      )
    );

    PERFORM public.recompute_buyer_refund_risk(r.buyer_id);

    RETURN jsonb_build_object('success', true, 'action', 'reject', 'refund', to_jsonb(r));
  END IF;

  IF v_action = 'request_info' THEN
    IF p_message IS NULL OR length(trim(p_message)) < 5 THEN
      RAISE EXCEPTION 'Message must be at least 5 characters';
    END IF;

    UPDATE public.refund_requests
    SET notes = COALESCE(notes, '') ||
      CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END ||
      '[seller ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' || trim(p_message),
        seller_decision = 'request_info',
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;

    SELECT dt.id INTO v_ticket
    FROM public.dispute_tickets dt
    WHERE dt.order_id = r.order_id
    ORDER BY dt.created_at DESC
    LIMIT 1;

    IF v_ticket IS NOT NULL THEN
      INSERT INTO public.dispute_comments (ticket_id, author_id, body)
      VALUES (v_ticket, auth.uid(), trim(p_message));
    END IF;

    INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
    VALUES (p_refund_id, 'request_info', auth.uid(), 'seller', v_before, v_before,
            jsonb_build_object('message', trim(p_message)));

    INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
    VALUES (
      r.buyer_id,
      'Seller needs more info',
      left(trim(p_message), 240),
      'order',
      '/orders/' || r.order_id,
      jsonb_build_object(
        'orderId', r.order_id,
        'refundId', r.id,
        'status', 'refund_info_requested',
        'target_role', 'buyer',
        'high_priority', true
      )
    );

    RETURN jsonb_build_object('success', true, 'action', 'request_info', 'refund', to_jsonb(r));
  END IF;

  -- Approve paths (wallet-only instant credit)
  IF v_action = 'approve_full' THEN
    v_approved := v_cap;
    v_decision := 'approve_full';
  ELSE
    v_approved := ROUND(COALESCE(p_amount, 0)::numeric, 2);
    v_decision := 'approve_partial';
    IF v_approved <= 0 OR v_approved > v_cap THEN
      RAISE EXCEPTION 'Partial amount must be between 0.01 and %', v_cap;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_feature_flags
    WHERE key = 'wallet_refund_credit_enabled' AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'Sociva Credit refunds are not enabled yet';
  END IF;

  UPDATE public.refund_requests
  SET refund_destination = 'wallet',
      refund_method = 'wallet',
      approved_amount = v_approved,
      wallet_credit_amount = v_approved,
      seller_decision = v_decision,
      refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'approve', auth.uid(), 'seller', v_before, 'approved',
          jsonb_build_object(
            'seller_decision', v_decision,
            'approved_amount', v_approved,
            'refund_destination', 'wallet'
          ));

  v_completed := public.complete_wallet_refund(p_refund_id);

  v_item_line := public.seller_order_item_summary(r.order_id);

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user,
    'Refund approved — settlement adjusted',
    left(
      'You approved ₹' || trim(to_char(v_approved, 'FM9999990.00'))
      || ' as Sociva Credit for the buyer. Buyer received instant wallet credit; your payout is adjusted accordingly.'
      || CASE WHEN v_item_line IS NOT NULL THEN ' · ' || v_item_line ELSE '' END,
      240
    ),
    'order',
    '/orders/' || r.order_id,
    jsonb_build_object(
      'orderId', r.order_id,
      'refundId', r.id,
      'status', 'refund_approved_seller',
      'target_role', 'seller',
      'approved_amount', v_approved,
      'seller_decision', v_decision
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', v_action,
    'approved_amount', v_approved,
    'refund', to_jsonb(v_completed)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_respond_refund(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_respond_refund(uuid, text, numeric, text) TO authenticated, service_role;

-- Backward-compatible approve_refund → wallet instant path
CREATE OR REPLACE FUNCTION public.approve_refund(p_refund_id uuid)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  r public.refund_requests;
  v_cap numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_res := public.seller_respond_refund(p_refund_id, 'approve_full', NULL, NULL);
    SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
    RETURN r;
  END IF;

  -- Service-role / cron path (no authenticated seller context)
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be approved from state: %', r.refund_state;
  END IF;

  v_cap := ROUND(COALESCE(r.requested_amount, r.amount, 0)::numeric, 2);

  UPDATE public.refund_requests
  SET refund_destination = 'wallet',
      refund_method = 'wallet',
      approved_amount = v_cap,
      wallet_credit_amount = v_cap,
      seller_decision = COALESCE(seller_decision, 'approve_full'),
      refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'approve', 'system', 'requested', 'approved',
          jsonb_build_object('approved_amount', v_cap, 'refund_destination', 'wallet'));

  PERFORM public.complete_wallet_refund(p_refund_id);
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_refund(uuid) TO authenticated, service_role;

-- reject_refund: notify buyer (seller_respond covers new flow; keep thin wrapper)
CREATE OR REPLACE FUNCTION public.reject_refund(p_refund_id uuid, p_reason text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  r public.refund_requests;
BEGIN
  v_res := public.seller_respond_refund(p_refund_id, 'reject', NULL, p_reason);
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_refund(uuid, text) TO authenticated, service_role;

-- ── request_refund: Sociva Credit only + requested_amount + risk refresh ────
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'wallet'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_existing uuid;
  v_seller_user uuid;
  v_dest text := 'wallet';
  v_eligibility jsonb;
  v_item_line text;
  v_idem text;
  v_amount numeric;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  v_eligibility := public.get_buyer_refund_eligibility(p_order_id);
  IF COALESCE((v_eligibility->>'eligible')::boolean, false) IS NOT TRUE THEN
    IF v_eligibility->>'reason' = 'window_closed' THEN
      RAISE EXCEPTION 'Refund window closed. Refunds must be requested within 2 hours of delivery.';
    ELSIF v_eligibility->>'reason' = 'not_delivered' THEN
      RAISE EXCEPTION 'Refunds can only be requested after the order is delivered';
    ELSE
      RAISE EXCEPTION 'This order is not eligible for a refund request';
    END IF;
  END IF;

  SELECT id INTO v_existing
  FROM refund_requests
  WHERE order_id = p_order_id
    AND refund_state NOT IN ('rejected', 'refund_completed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_amount := COALESCE(
    NULLIF(v_order.frozen_total, 0),
    COALESCE(v_order.total_amount, 0)
      + COALESCE(v_order.wallet_cash_amount, 0)
      + COALESCE(v_order.wallet_promo_amount, 0)
  );

  BEGIN
    INSERT INTO refund_requests (
      order_id, buyer_id, seller_id, society_id, amount, requested_amount, reason, category,
      evidence_urls, refund_method, refund_destination, wallet_credit_amount,
      status, refund_state
    )
    VALUES (
      p_order_id,
      v_order.buyer_id,
      v_order.seller_id,
      v_order.society_id,
      v_amount,
      v_amount,
      p_reason,
      p_category,
      p_evidence_urls,
      'wallet',
      v_dest,
      v_amount,
      'requested',
      'requested'
    )
    RETURNING id INTO v_refund_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_refund_id
      FROM refund_requests
      WHERE order_id = p_order_id
        AND refund_state NOT IN ('rejected', 'refund_completed')
      ORDER BY created_at DESC
      LIMIT 1;
      IF v_refund_id IS NULL THEN
        RAISE;
      END IF;
      RETURN v_refund_id;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dispute_tickets
    WHERE order_id = p_order_id AND status != 'resolved'
  ) THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (
      p_order_id,
      auth.uid(),
      (SELECT sp.user_id FROM seller_profiles sp WHERE sp.id = v_order.seller_id),
      p_reason,
      p_category,
      'open',
      v_order.society_id
    );
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    v_item_line := public.seller_order_item_summary(p_order_id);
    v_idem := md5(p_order_id::text || '-refund_requested-' || v_refund_id::text);

    INSERT INTO public.notification_queue (
      user_id, type, title, body, reference_path, payload, idempotency_key
    )
    VALUES (
      v_seller_user,
      'refund_request',
      'Refund / dispute needs response',
      left(
        COALESCE(
          (SELECT name FROM profiles WHERE id = v_order.buyer_id),
          'A buyer'
        ) || ' requested ₹' || trim(to_char(v_amount, 'FM9999990'))
        || ' refund (Sociva Credit if approved)'
        || CASE WHEN v_item_line IS NOT NULL THEN ' · ' || v_item_line ELSE '' END
        || '. Respond within 48 hours.',
        240
      ),
      '/seller?tab=refunds&refundId=' || v_refund_id::text,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'high_priority', true,
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest,
        'refund_amount', v_amount,
        'item_summary', v_item_line,
        'reference_path', '/seller?tab=refunds&refundId=' || v_refund_id::text,
        'action', 'view_refund'
      ),
      v_idem
    )
    ON CONFLICT ON CONSTRAINT idx_notification_queue_idempotency DO NOTHING;
  END IF;

  PERFORM public.recompute_buyer_refund_risk(v_order.buyer_id);

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- list_seller_refund_requests: expose partial amounts
CREATE OR REPLACE FUNCTION public.list_seller_refund_requests(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) AS sid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = sid AND sp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
    FROM (
      SELECT
        rr.id,
        rr.order_id,
        rr.status,
        rr.refund_state,
        rr.category,
        rr.reason,
        rr.amount,
        rr.requested_amount,
        rr.approved_amount,
        rr.seller_decision,
        rr.refund_destination,
        rr.created_at,
        rr.seller_id
      FROM public.refund_requests rr
      WHERE rr.seller_id = ANY(p_seller_ids)
      ORDER BY rr.created_at DESC
      LIMIT 100
    ) r
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_seller_refund_requests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_seller_refund_requests(uuid[]) TO authenticated;
