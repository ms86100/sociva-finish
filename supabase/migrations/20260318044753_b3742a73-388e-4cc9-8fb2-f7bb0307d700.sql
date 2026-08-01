CREATE OR REPLACE FUNCTION public.compute_store_status(
  p_start time without time zone,
  p_end time without time zone,
  p_days text[],
  p_available boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
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
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0 AND NOT (v_current_day = ANY(p_days)) THEN
    RETURN jsonb_build_object('status', 'closed_today', 'next_open_at', null, 'minutes_until_open', null);
  END IF;

  -- Treat 00:00:00 as end-of-day (23:59:59) so "09:00-00:00" means open until midnight
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;

  -- Detect overnight hours (e.g. 20:00 - 02:00)
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
$$;