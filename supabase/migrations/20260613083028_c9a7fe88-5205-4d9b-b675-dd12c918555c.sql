ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS booking_slot_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS booking_slot_buffer_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_slot_max_capacity integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_slots_store_level
  ON public.service_slots (seller_id, slot_date, start_time)
  WHERE product_id IS NULL;

CREATE OR REPLACE FUNCTION public.generate_service_slots_for_seller(
  p_seller_id uuid,
  p_horizon_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_duration int;
  v_buffer int;
  v_capacity int;
  v_has_bookable boolean;
  v_day_offset integer;
  v_date date;
  v_dow integer;
  v_sched record;
  v_cur_min integer;
  v_end_min integer;
  v_slot_start time;
  v_slot_end time;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(booking_slot_minutes, 60),
         COALESCE(booking_slot_buffer_minutes, 0),
         COALESCE(booking_slot_max_capacity, 1)
  INTO v_duration, v_buffer, v_capacity
  FROM public.seller_profiles
  WHERE id = p_seller_id;

  IF v_duration IS NULL OR v_duration <= 0 THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.service_listings sl
    JOIN public.products p ON p.id = sl.product_id
    WHERE p.seller_id = p_seller_id
      AND p.approval_status = 'approved'
  ) INTO v_has_bookable;

  DELETE FROM public.service_slots ss
  WHERE ss.seller_id = p_seller_id
    AND ss.slot_date >= v_today
    AND ss.booked_count = 0
    AND ss.is_blocked = false
    AND NOT EXISTS (
      SELECT 1 FROM public.service_bookings sb WHERE sb.slot_id = ss.id
    );

  IF NOT v_has_bookable THEN
    RETURN 0;
  END IF;

  FOR v_day_offset IN 0 .. (p_horizon_days - 1) LOOP
    v_date := v_today + v_day_offset;
    v_dow  := EXTRACT(DOW FROM v_date)::int;

    SELECT start_time, end_time, is_active
    INTO v_sched
    FROM public.service_availability_schedules
    WHERE seller_id = p_seller_id
      AND product_id IS NULL
      AND day_of_week = v_dow
    LIMIT 1;

    IF NOT FOUND OR v_sched.is_active = false THEN
      CONTINUE;
    END IF;

    v_cur_min := EXTRACT(HOUR FROM v_sched.start_time)::int * 60
               + EXTRACT(MINUTE FROM v_sched.start_time)::int;
    v_end_min := EXTRACT(HOUR FROM v_sched.end_time)::int * 60
               + EXTRACT(MINUTE FROM v_sched.end_time)::int;

    IF v_end_min <= v_cur_min THEN
      CONTINUE;
    END IF;

    WHILE v_cur_min + v_duration <= v_end_min LOOP
      v_slot_start := make_time(v_cur_min / 60, v_cur_min % 60, 0);
      v_slot_end   := make_time(
        (v_cur_min + v_duration) / 60,
        (v_cur_min + v_duration) % 60,
        0
      );

      INSERT INTO public.service_slots (
        seller_id, product_id, slot_date, day_of_week,
        start_time, end_time,
        max_capacity, booked_count, is_blocked
      )
      VALUES (
        p_seller_id, NULL, v_date, v_dow,
        v_slot_start, v_slot_end,
        v_capacity, 0, false
      )
      ON CONFLICT (seller_id, slot_date, start_time) WHERE product_id IS NULL DO NOTHING;

      IF FOUND THEN
        v_inserted := v_inserted + 1;
      END IF;

      v_cur_min := v_cur_min + v_duration + v_buffer;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_regen_slots_on_seller_config()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.booking_slot_minutes IS DISTINCT FROM OLD.booking_slot_minutes
     OR NEW.booking_slot_buffer_minutes IS DISTINCT FROM OLD.booking_slot_buffer_minutes
     OR NEW.booking_slot_max_capacity IS DISTINCT FROM OLD.booking_slot_max_capacity
  THEN
    PERFORM public.generate_service_slots_for_seller(NEW.id, 30);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_profiles_regen_slots ON public.seller_profiles;
CREATE TRIGGER trg_seller_profiles_regen_slots
AFTER UPDATE OF booking_slot_minutes, booking_slot_buffer_minutes, booking_slot_max_capacity
ON public.seller_profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_regen_slots_on_seller_config();

SELECT public.cron_extend_all_seller_slots();
