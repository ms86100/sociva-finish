
-- Create overloaded compute_store_status that accepts manual_override params
-- This matches the call signature in the latest create_multi_vendor_orders RPC
CREATE OR REPLACE FUNCTION public.compute_store_status(
  p_start time without time zone,
  p_end time without time zone,
  p_manual_override text,
  p_manual_override_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_current_time time := v_now::time;
  v_next_open timestamptz;
  v_minutes_until int;
  v_effective_end time;
  v_is_overnight boolean;
  v_is_open boolean;
BEGIN
  -- Check manual override first
  IF p_manual_override IS NOT NULL AND p_manual_override != '' THEN
    -- Check if override has expired
    IF p_manual_override_until IS NOT NULL AND now() > p_manual_override_until THEN
      -- Override expired, fall through to normal logic
      NULL;
    ELSIF p_manual_override = 'open' THEN
      RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
    ELSIF p_manual_override = 'closed' THEN
      RETURN jsonb_build_object('status', 'paused', 'next_open_at', null, 'minutes_until_open', null);
    END IF;
  END IF;

  -- No hours set = always open
  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  END IF;

  -- Treat 00:00:00 as end-of-day
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;

  -- Detect overnight hours
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
