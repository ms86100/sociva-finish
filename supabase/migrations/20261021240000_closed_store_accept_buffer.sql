-- Closed-store first slots are open + prep (often 15 min). Expire at the later
-- of the chosen slot and store-open + 30 min so the seller can actually cook.

CREATE OR REPLACE FUNCTION public.closed_store_accept_deadline(
  p_start time,
  p_scheduled_date date,
  p_scheduled_time time
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_slot timestamptz;
  v_open_plus timestamptz;
BEGIN
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL THEN
    RETURN NULL;
  END IF;

  v_slot := (p_scheduled_date + p_scheduled_time) AT TIME ZONE 'Asia/Kolkata';
  IF p_start IS NULL OR p_scheduled_time < p_start THEN
    RETURN v_slot;
  END IF;

  v_open_plus := (p_scheduled_date + p_start) AT TIME ZONE 'Asia/Kolkata'
    + interval '30 minutes';
  IF v_open_plus > v_slot THEN
    RETURN v_open_plus;
  END IF;
  RETURN v_slot;
END;
$$;

DO $mig$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF position('closed_store_accept_deadline' in src) > 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders already uses closed_store_accept_deadline';
    RETURN;
  END IF;

  IF position($old$      if _must_schedule then
        _auto_cancel_at := (nullif(_scheduled_date, '')::date
          + nullif(_scheduled_time_start, '')::time) AT TIME ZONE 'Asia/Kolkata';
      else
        _auto_cancel_at := now() + interval '30 minutes';
      end if;$old$ in src) = 0 THEN
    RAISE EXCEPTION 'closed-store auto_cancel stamp anchor not found on create_multi_vendor_orders';
  END IF;

  src := replace(src,
$old$      if _must_schedule then
        _auto_cancel_at := (nullif(_scheduled_date, '')::date
          + nullif(_scheduled_time_start, '')::time) AT TIME ZONE 'Asia/Kolkata';
      else
        _auto_cancel_at := now() + interval '30 minutes';
      end if;$old$,
$new$      if _must_schedule then
        _auto_cancel_at := public.closed_store_accept_deadline(
          (SELECT sp.availability_start FROM public.seller_profiles sp WHERE sp.id = _seller_id),
          nullif(_scheduled_date, '')::date,
          nullif(_scheduled_time_start, '')::time
        );
      else
        _auto_cancel_at := now() + interval '30 minutes';
      end if;$new$);

  EXECUTE src;
END;
$mig$;
