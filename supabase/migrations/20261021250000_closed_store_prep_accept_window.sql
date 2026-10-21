-- Closed-store first slots were open + prep (often 15 min). Expiring at the
-- slot left no cook time; expiring after the slot let sellers accept late food.
-- Push a future session's first slot to open + 30 min + prep, and expire at
-- preparation start so accept + cook both fit before the promise.
-- Also keep buyer cancel open until shortly before prep, and pin store-status
-- day names to POSIX C.

CREATE OR REPLACE FUNCTION public.store_scheduled_slot_is_valid(
  p_start time,
  p_end time,
  p_days text[],
  p_available boolean,
  p_vacation boolean,
  p_prep_minutes integer,
  p_lead_minutes integer,
  p_scheduled_date date,
  p_scheduled_time time
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_slot_ts timestamptz;
  v_start_m int;
  v_raw_end int;
  v_end_m int;
  v_slot_m int;
  v_prep int;
  v_lead int;
  v_earliest int;
  v_overnight boolean;
  v_session_start timestamptz;
BEGIN
  IF coalesce(p_vacation, false) OR p_available = false THEN
    RETURN false;
  END IF;
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL THEN
    RETURN false;
  END IF;

  v_slot_ts := (p_scheduled_date + p_scheduled_time) AT TIME ZONE 'Asia/Kolkata';
  v_prep := GREATEST(COALESCE(p_prep_minutes, 15), 15);
  v_lead := GREATEST(COALESCE(p_lead_minutes, 0), 0);
  IF v_slot_ts <= now() + make_interval(mins => v_lead) THEN
    RETURN false;
  END IF;
  IF (EXTRACT(MINUTE FROM p_scheduled_time)::int % 15) <> 0 THEN
    RETURN false;
  END IF;

  v_slot_m := EXTRACT(HOUR FROM p_scheduled_time)::int * 60
            + EXTRACT(MINUTE FROM p_scheduled_time)::int;

  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN v_slot_ts >= now() + make_interval(mins => v_prep + v_lead);
  END IF;

  v_start_m := EXTRACT(HOUR FROM p_start)::int * 60 + EXTRACT(MINUTE FROM p_start)::int;
  v_raw_end := EXTRACT(HOUR FROM p_end)::int * 60 + EXTRACT(MINUTE FROM p_end)::int;
  v_end_m := CASE WHEN v_raw_end = 0 THEN 1440 ELSE v_raw_end END;
  v_overnight := v_end_m <= v_start_m;
  v_earliest := CEIL((v_start_m + v_prep)::numeric / 15) * 15;

  IF v_overnight THEN
    IF v_slot_m >= v_start_m THEN
      v_session_start := (p_scheduled_date + p_start) AT TIME ZONE 'Asia/Kolkata';
      IF v_session_start > now() THEN
        v_earliest := CEIL((v_start_m + v_prep + 30)::numeric / 15) * 15;
      END IF;
    END IF;
    IF v_slot_m >= v_earliest THEN
      RETURN public.store_operating_on(p_days, p_scheduled_date);
    ELSIF v_slot_m < v_end_m THEN
      RETURN public.store_operating_on(p_days, p_scheduled_date - 1);
    END IF;
    RETURN false;
  END IF;

  v_session_start := (p_scheduled_date + p_start) AT TIME ZONE 'Asia/Kolkata';
  IF v_session_start > now() THEN
    v_earliest := CEIL((v_start_m + v_prep + 30)::numeric / 15) * 15;
  END IF;

  RETURN public.store_operating_on(p_days, p_scheduled_date)
     AND v_slot_m >= v_earliest
     AND v_slot_m < v_end_m;
END;
$fn$;

DROP FUNCTION IF EXISTS public.closed_store_accept_deadline(time, date, time);

CREATE FUNCTION public.closed_store_accept_deadline(
  p_start time,
  p_scheduled_date date,
  p_scheduled_time time,
  p_prep_minutes integer DEFAULT 15
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_slot timestamptz;
  v_open timestamptz;
  v_prep int;
  v_prep_start timestamptz;
BEGIN
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL THEN
    RETURN NULL;
  END IF;

  v_slot := (p_scheduled_date + p_scheduled_time) AT TIME ZONE 'Asia/Kolkata';
  IF p_start IS NULL OR p_scheduled_time < p_start THEN
    RETURN v_slot;
  END IF;

  v_prep := GREATEST(COALESCE(p_prep_minutes, 15), 15);
  v_prep_start := v_slot - make_interval(mins => v_prep);
  v_open := (p_scheduled_date + p_start) AT TIME ZONE 'Asia/Kolkata';
  IF v_prep_start < v_open THEN
    v_prep_start := v_open;
  END IF;
  IF v_prep_start > v_slot THEN
    RETURN v_slot;
  END IF;
  RETURN v_prep_start;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_orders_compute_scheduled_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_times record;
  v_grace interval := interval '15 minutes';
  v_prep int := 60;
BEGIN
  IF NEW.scheduled_date IS NULL THEN
    NEW.preparation_start_at := NULL;
    NEW.scheduled_fulfillment_at := NULL;
    NEW.cancellation_cutoff_at := NULL;
    RETURN NEW;
  END IF;

  SELECT GREATEST(COALESCE(MAX(GREATEST(COALESCE(p.prep_time_minutes, 15), 15)), 60), 15)
    INTO v_prep
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.id;

  IF v_prep IS NULL THEN
    v_prep := 60;
  END IF;

  SELECT * INTO v_times
  FROM public.compute_scheduled_order_times(
    NEW.scheduled_date,
    COALESCE(NEW.scheduled_time_start, NEW.scheduled_time, time '12:00'),
    v_prep,
    24
  );

  NEW.scheduled_fulfillment_at := v_times.scheduled_fulfillment_at;
  NEW.preparation_start_at := v_times.preparation_start_at;
  NEW.cancellation_cutoff_at := v_times.cancellation_cutoff_at;

  IF TG_OP = 'INSERT'
     AND NEW.scheduled_fulfillment_at IS NOT NULL
     AND NEW.scheduled_fulfillment_at < (now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'Scheduled time is in the past. Choose a later slot.';
  END IF;

  -- Same-day / next-morning: keep cancel open until shortly before prep,
  -- instead of flattening to now + 15 minutes.
  IF NEW.cancellation_cutoff_at IS NOT NULL AND NEW.cancellation_cutoff_at <= now() THEN
    NEW.cancellation_cutoff_at := COALESCE(
      NEW.preparation_start_at, NEW.scheduled_fulfillment_at, now() + v_grace
    ) - v_grace;
    IF NEW.preparation_start_at IS NOT NULL
       AND NEW.cancellation_cutoff_at > NEW.preparation_start_at THEN
      NEW.cancellation_cutoff_at := NEW.preparation_start_at;
    END IF;
    IF NEW.cancellation_cutoff_at <= now() THEN
      NEW.cancellation_cutoff_at := LEAST(
        COALESCE(NEW.preparation_start_at, now() + v_grace),
        now() + v_grace
      );
      IF NEW.cancellation_cutoff_at <= now() THEN
        NEW.cancellation_cutoff_at := now() + v_grace;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_refresh_order_scheduled_times_from_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order_id uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE public.orders
     SET scheduled_date = scheduled_date
   WHERE id = v_order_id
     AND scheduled_date IS NOT NULL;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_refresh_order_scheduled_times_from_items ON public.order_items;
CREATE TRIGGER trg_refresh_order_scheduled_times_from_items
AFTER INSERT OR UPDATE OF product_id ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_order_scheduled_times_from_items();

CREATE OR REPLACE FUNCTION public.compute_store_status(
  p_start time without time zone,
  p_end time without time zone,
  p_days text[],
  p_available boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET lc_time TO 'C'
AS $fn$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_current_time time := v_now::time;
  v_current_day text := to_char(v_now, 'Dy');
  v_next_open timestamptz;
  v_minutes_until int;
  v_effective_end time;
  v_is_overnight boolean;
  v_is_open boolean;
BEGIN
  IF p_available = false THEN
    RETURN jsonb_build_object('status', 'paused', 'next_open_at', null, 'minutes_until_open', null);
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  END IF;
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p_days) AS d
       WHERE lower(left(btrim(d), 3)) = lower(left(v_current_day, 3))
          OR (btrim(d) ~ '^\d+$' AND btrim(d)::int = EXTRACT(DOW FROM v_now)::int)
     )
  THEN
    RETURN jsonb_build_object('status', 'closed_today', 'next_open_at', null, 'minutes_until_open', null);
  END IF;
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;
  v_is_overnight := v_effective_end <= p_start;
  IF v_is_overnight THEN
    v_is_open := v_current_time >= p_start OR v_current_time < v_effective_end;
  ELSE
    v_is_open := v_current_time >= p_start AND v_current_time < v_effective_end;
  END IF;
  IF v_is_open THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  ELSE
    IF v_current_time < p_start THEN
      v_minutes_until := EXTRACT(EPOCH FROM (p_start - v_current_time))::int / 60;
      v_next_open := date_trunc('day', v_now) + p_start;
    ELSE
      v_next_open := date_trunc('day', v_now) + interval '1 day' + p_start;
      v_minutes_until := EXTRACT(EPOCH FROM (v_next_open - v_now))::int / 60;
    END IF;
    RETURN jsonb_build_object('status', 'closed', 'next_open_at', v_next_open, 'minutes_until_open', v_minutes_until);
  END IF;
END;
$fn$;

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

  IF position('_prep_minutes' in substr(src, position('closed_store_accept_deadline' in src), 280)) > 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders already passes prep into closed_store_accept_deadline';
    RETURN;
  END IF;

  IF position($old$        _auto_cancel_at := public.closed_store_accept_deadline(
          (SELECT sp.availability_start FROM public.seller_profiles sp WHERE sp.id = _seller_id),
          nullif(_scheduled_date, '')::date,
          nullif(_scheduled_time_start, '')::time
        );$old$ in src) = 0 THEN
    RAISE EXCEPTION 'closed_store_accept_deadline call site not found on create_multi_vendor_orders';
  END IF;

  src := replace(src,
$old$        _auto_cancel_at := public.closed_store_accept_deadline(
          (SELECT sp.availability_start FROM public.seller_profiles sp WHERE sp.id = _seller_id),
          nullif(_scheduled_date, '')::date,
          nullif(_scheduled_time_start, '')::time
        );$old$,
$new$        _auto_cancel_at := public.closed_store_accept_deadline(
          (SELECT sp.availability_start FROM public.seller_profiles sp WHERE sp.id = _seller_id),
          nullif(_scheduled_date, '')::date,
          nullif(_scheduled_time_start, '')::time,
          _prep_minutes
        );$new$);

  EXECUTE src;
END;
$mig$;
