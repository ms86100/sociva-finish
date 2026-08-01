-- Phase 2: Safe unpaid auto-cancel
-- 1) Longer hold window for unpaid online orders (45 min, was 3 min)
-- 2) Never cancel once payment_status = buyer_confirmed (seller verifying)
-- 3) DB RPC + 10-minute cron (no broken HTTP edge / free-tier hammer)

-- ── Patch create_multi_vendor_orders: 3 minutes → 45 minutes ─────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF position('interval ''3 minutes''' in def) = 0
     AND position('interval ''3 minute''' in def) = 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders: no 3-minute auto_cancel interval found — skipping patch';
    RETURN;
  END IF;

  def := replace(def, 'interval ''3 minutes''', 'interval ''45 minutes''');
  def := replace(def, 'interval ''3 minute''', 'interval ''45 minutes''');
  EXECUTE def;
END $$;

-- Extend still-open unpaid holds that were stamped with the old short window
UPDATE public.orders
SET auto_cancel_at = created_at + interval '45 minutes',
    updated_at = now()
WHERE status = 'payment_pending'
  AND payment_status = 'pending'
  AND COALESCE(payment_type, '') <> 'cod'
  AND auto_cancel_at IS NOT NULL
  AND auto_cancel_at < created_at + interval '10 minutes'
  AND auto_cancel_at > now(); -- only those not already expired

-- ── Solid cancel RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_unpaid_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cancelled_ids uuid[] := '{}';
  r record;
BEGIN
  -- Unpaid online past auto_cancel_at only.
  -- Skip buyer_confirmed (seller verifying) and paid / COD.
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.auto_cancel_at IS NOT NULL
      AND o.auto_cancel_at < now()
      AND o.status = 'payment_pending'::order_status
      AND o.payment_status = 'pending'
      AND COALESCE(o.payment_type, '') <> 'cod'
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders
    SET status = 'cancelled'::order_status,
        rejection_reason = 'Order was cancelled as payment was not completed in time',
        auto_cancel_at = NULL,
        updated_at = now()
    WHERE id = r.id
      AND status = 'payment_pending'::order_status
      AND payment_status = 'pending';

    IF FOUND THEN
      cancelled_ids := array_append(cancelled_ids, r.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cancelled_count', COALESCE(array_length(cancelled_ids, 1), 0),
    'cancelled_ids', to_jsonb(cancelled_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_cancel_expired_unpaid_orders() FROM PUBLIC;
-- Cron / service_role only — not callable by clients
GRANT EXECUTE ON FUNCTION public.auto_cancel_expired_unpaid_orders() TO service_role;

-- ── Cron: every 10 minutes (replace any prior auto-cancel HTTP jobs) ─────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
            'auto_cancel_orders_every_2m',
            'auto-cancel-orders',
            'auto_cancel_orders',
            'auto_cancel_expired_unpaid_every_10m'
          )
       OR command ILIKE '%auto-cancel-orders%'
       OR command ILIKE '%auto_cancel_expired_unpaid_orders%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'auto_cancel_expired_unpaid_every_10m',
  '*/10 * * * *',
  $cron$ SELECT public.auto_cancel_expired_unpaid_orders(); $cron$
);
