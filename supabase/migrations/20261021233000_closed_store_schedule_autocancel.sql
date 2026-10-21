-- Closed-store scheduled orders must not inherit the 30-minute instant-order
-- accept window. The seller is off-hours; expire at the chosen IST slot instead.
-- Also pin store_operating_on day names to POSIX C so 'Dy' stays Mon/Tue.

CREATE OR REPLACE FUNCTION public.store_operating_on(p_days text[], p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
SET lc_time = 'C'
AS $$
  SELECT p_days IS NULL
      OR coalesce(array_length(p_days, 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM unnest(p_days) AS d
        WHERE lower(left(btrim(d), 3)) = lower(to_char(p_date, 'Dy'))
           OR (btrim(d) ~ '^\d+$' AND btrim(d)::int = EXTRACT(DOW FROM p_date)::int)
      );
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

  IF position('_auto_cancel_at := (nullif(_scheduled_date, '''')::date' in src) > 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders already stamps closed-store auto_cancel at the slot';
    RETURN;
  END IF;

  IF position($old$    if _scheduled_date is not null and _scheduled_time_start is not null then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;$old$ in src) = 0 THEN
    RAISE EXCEPTION 'scheduled auto_cancel stamp anchor not found on create_multi_vendor_orders';
  END IF;

  src := replace(src,
$old$    if _scheduled_date is not null and _scheduled_time_start is not null then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;$old$,
$new$    if _scheduled_date is not null and _scheduled_time_start is not null then
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
      if _must_schedule then
        _auto_cancel_at := (nullif(_scheduled_date, '')::date
          + nullif(_scheduled_time_start, '')::time) AT TIME ZONE 'Asia/Kolkata';
      else
        _auto_cancel_at := now() + interval '30 minutes';
      end if;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;$new$);

  EXECUTE src;
END;
$mig$;
