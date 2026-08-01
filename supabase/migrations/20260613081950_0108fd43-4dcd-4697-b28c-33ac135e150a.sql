CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

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
  v_listing record;
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

  DELETE FROM public.service_slots ss
  WHERE ss.seller_id = p_seller_id
    AND ss.slot_date >= v_today
    AND ss.booked_count = 0
    AND ss.is_blocked = false
    AND NOT EXISTS (
      SELECT 1 FROM public.service_bookings sb WHERE sb.slot_id = ss.id
    );

  FOR v_listing IN
    SELECT sl.product_id,
           COALESCE(sl.duration_minutes, 60) AS duration_minutes,
           COALESCE(sl.buffer_minutes, 0)    AS buffer_minutes,
           COALESCE(sl.max_bookings_per_slot, 1) AS max_capacity
    FROM public.service_listings sl
    JOIN public.products p ON p.id = sl.product_id
    WHERE p.seller_id = p_seller_id
      AND p.approval_status = 'approved'
  LOOP
    FOR v_day_offset IN 0 .. (p_horizon_days - 1) LOOP
      v_date := v_today + v_day_offset;
      v_dow  := EXTRACT(DOW FROM v_date)::int;

      SELECT start_time, end_time, is_active
      INTO v_sched
      FROM public.service_availability_schedules
      WHERE seller_id = p_seller_id
        AND day_of_week = v_dow
        AND (product_id = v_listing.product_id OR product_id IS NULL)
      ORDER BY product_id NULLS LAST
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

      WHILE v_cur_min + v_listing.duration_minutes <= v_end_min LOOP
        v_slot_start := make_time(v_cur_min / 60, v_cur_min % 60, 0);
        v_slot_end   := make_time(
          (v_cur_min + v_listing.duration_minutes) / 60,
          (v_cur_min + v_listing.duration_minutes) % 60,
          0
        );

        INSERT INTO public.service_slots (
          seller_id, product_id, slot_date, day_of_week,
          start_time, end_time,
          max_capacity, booked_count, is_blocked
        )
        VALUES (
          p_seller_id, v_listing.product_id, v_date, v_dow,
          v_slot_start, v_slot_end,
          v_listing.max_capacity, 0, false
        )
        ON CONFLICT (seller_id, product_id, slot_date, start_time) DO NOTHING;

        IF FOUND THEN
          v_inserted := v_inserted + 1;
        END IF;

        v_cur_min := v_cur_min + v_listing.duration_minutes + v_listing.buffer_minutes;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_service_slots_for_seller(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_service_slots_for_seller(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_regen_slots_on_product_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE'
      AND NEW.approval_status = 'approved'
      AND COALESCE(OLD.approval_status, '') <> 'approved')
     AND EXISTS (SELECT 1 FROM public.service_listings WHERE product_id = NEW.id)
  THEN
    PERFORM public.generate_service_slots_for_seller(NEW.seller_id, 30);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_approval_regen_slots ON public.products;
CREATE TRIGGER trg_products_approval_regen_slots
AFTER UPDATE OF approval_status ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.trg_regen_slots_on_product_approval();

CREATE OR REPLACE FUNCTION public.trg_regen_slots_on_service_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT seller_id INTO v_seller_id FROM public.products
  WHERE id = COALESCE(NEW.product_id, OLD.product_id);
  IF v_seller_id IS NOT NULL THEN
    PERFORM public.generate_service_slots_for_seller(v_seller_id, 30);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_service_listings_regen_slots ON public.service_listings;
CREATE TRIGGER trg_service_listings_regen_slots
AFTER INSERT OR UPDATE OF duration_minutes, buffer_minutes, max_bookings_per_slot ON public.service_listings
FOR EACH ROW
EXECUTE FUNCTION public.trg_regen_slots_on_service_listing();

CREATE OR REPLACE FUNCTION public.trg_regen_slots_on_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  v_seller_id := COALESCE(NEW.seller_id, OLD.seller_id);
  IF v_seller_id IS NOT NULL THEN
    PERFORM public.generate_service_slots_for_seller(v_seller_id, 30);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_regen_slots ON public.service_availability_schedules;
CREATE TRIGGER trg_schedules_regen_slots
AFTER INSERT OR UPDATE OR DELETE ON public.service_availability_schedules
FOR EACH ROW
EXECUTE FUNCTION public.trg_regen_slots_on_schedule();

CREATE OR REPLACE FUNCTION public.cron_extend_all_seller_slots()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.seller_id
    FROM public.service_listings sl
    JOIN public.products p ON p.id = sl.product_id
    WHERE p.approval_status = 'approved'
  LOOP
    PERFORM public.generate_service_slots_for_seller(r.seller_id, 30);
  END LOOP;
END;
$$;

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'extend-service-slots-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'extend-service-slots-daily',
    '0 2 * * *',
    $cron$ SELECT public.cron_extend_all_seller_slots(); $cron$
  );
END;
$$;

SELECT public.cron_extend_all_seller_slots();
