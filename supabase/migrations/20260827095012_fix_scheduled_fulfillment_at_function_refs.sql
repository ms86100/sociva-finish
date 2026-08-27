-- Fix remaining DB function bodies after column rename
-- scheduled_fulfilment_at → scheduled_fulfillment_at

DROP FUNCTION IF EXISTS public.compute_scheduled_order_times(date, time without time zone, integer, integer);

CREATE FUNCTION public.compute_scheduled_order_times(
  p_scheduled_date date,
  p_scheduled_time time without time zone,
  p_prep_minutes integer DEFAULT 60,
  p_cancel_hours integer DEFAULT 24
)
RETURNS TABLE(
  scheduled_fulfillment_at timestamp with time zone,
  preparation_start_at timestamp with time zone,
  cancellation_cutoff_at timestamp with time zone
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata' AS scheduled_fulfillment_at,
    ((p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata')
      - make_interval(mins => GREATEST(COALESCE(p_prep_minutes, 60), 15)) AS preparation_start_at,
    ((p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata')
      - make_interval(hours => GREATEST(COALESCE(p_cancel_hours, 24), 1)) AS cancellation_cutoff_at
  WHERE p_scheduled_date IS NOT NULL;
$$;

DO $$
DECLARE
  r record;
  src text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'compute_scheduled_order_times'
      AND p.prosrc ILIKE '%scheduled_fulfilment_at%'
  LOOP
    src := pg_get_functiondef(r.oid);
    src := replace(src, 'scheduled_fulfilment_at', 'scheduled_fulfillment_at');
    EXECUTE src;
  END LOOP;
END $$;
