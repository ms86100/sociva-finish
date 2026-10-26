-- DEF-001: Instant seller acceptance window 300s -> 1800s (30 minutes).
-- Authoritative deadline remains orders.auto_cancel_at via
-- schedule_order_acceptance_expiry / _order_acceptance_timeout_seconds().
-- Scheduled / closed-store prep stamps that already set auto_cancel_at are preserved
-- (scheduler keeps a future stamp and does not overwrite with the instant timeout).

UPDATE public.system_settings
SET
  value = '1800'::jsonb,
  description = 'Seconds a placed instant order may wait for seller acceptance before auto-cancel (30 minutes)',
  updated_at = now()
WHERE key = 'order_acceptance_timeout_seconds';

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'order_acceptance_timeout_seconds',
  '1800'::jsonb,
  'Seconds a placed instant order may wait for seller acceptance before auto-cancel (30 minutes)'
)
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = now();

-- Keep urgent-grace setting aligned when it mirrored the old 5-minute window.
UPDATE public.system_settings
SET
  value = '1800'::jsonb,
  description = 'Seller acceptance window for placed orders (seconds)',
  updated_at = now()
WHERE key = 'auto_cancel_grace_urgent_seconds'
  AND (value #>> '{}') IN ('300', '5');

-- Default fallback when setting missing/invalid: 1800 (was 300).
CREATE OR REPLACE FUNCTION public._order_acceptance_timeout_seconds()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v int;
BEGIN
  SELECT NULLIF(trim(value #>> '{}'), '')::integer
  INTO v
  FROM public.system_settings
  WHERE key = 'order_acceptance_timeout_seconds'
  LIMIT 1;

  IF v IS NULL OR v < 30 OR v > 7200 THEN
    RETURN 1800;
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 1800;
END;
$$;

REVOKE ALL ON FUNCTION public._order_acceptance_timeout_seconds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._order_acceptance_timeout_seconds() TO postgres, service_role;

-- DEF-002: honest delivery evidence on queue rows (never implies audible success).
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS delivery_evidence jsonb;

COMMENT ON COLUMN public.notification_queue.delivery_evidence IS
  'Structured push evidence. provider_accepted is not device delivery or audible playback.';

-- Ops view: pending seller accept + latest notify evidence (no tokens / PII).
CREATE OR REPLACE VIEW public.seller_alert_ops_snapshot AS
SELECT
  o.id AS order_id,
  left(o.id::text, 8) AS order_short,
  o.status,
  o.scheduled_date,
  o.auto_cancel_at,
  o.created_at,
  o.preparation_start_at,
  EXTRACT(EPOCH FROM (o.auto_cancel_at - now())) AS seconds_to_deadline,
  (
    SELECT nq.status
    FROM public.notification_queue nq
    WHERE nq.payload->>'order_id' = o.id::text
      AND nq.payload->>'target_role' = 'seller'
    ORDER BY nq.created_at DESC
    LIMIT 1
  ) AS last_notify_status,
  (
    SELECT nq.push_success_count
    FROM public.notification_queue nq
    WHERE nq.payload->>'order_id' = o.id::text
      AND nq.payload->>'target_role' = 'seller'
    ORDER BY nq.created_at DESC
    LIMIT 1
  ) AS last_push_success_count,
  (
    SELECT nq.delivery_evidence
    FROM public.notification_queue nq
    WHERE nq.payload->>'order_id' = o.id::text
      AND nq.payload->>'target_role' = 'seller'
    ORDER BY nq.created_at DESC
    LIMIT 1
  ) AS last_delivery_evidence
FROM public.orders o
WHERE o.status = 'placed'
  AND o.auto_cancel_at IS NOT NULL
  AND o.auto_cancel_at > now();

REVOKE ALL ON public.seller_alert_ops_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_alert_ops_snapshot TO service_role;
