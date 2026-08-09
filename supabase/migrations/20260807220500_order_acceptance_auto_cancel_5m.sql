-- ============================================================
-- Order acceptance auto-cancel (exactly 5 minutes)
-- Event-driven: schedule per-order timer on becoming `placed`.
-- Expiry cancels by primary key only (O(1)) — no pending-order scans.
-- ============================================================

-- Older production snapshots can have the auto-accept trigger body without
-- the seller capacity column it reads. Make the runtime dependency explicit.
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS daily_order_limit integer;

-- 1) Settings
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'order_acceptance_timeout_seconds',
  '300'::jsonb,
  'Seconds a placed order may wait for seller acceptance before auto-cancel'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

UPDATE public.system_settings
SET value = '300'::jsonb,
    description = 'Seller acceptance window for placed orders (seconds)',
    updated_at = now()
WHERE key = 'auto_cancel_grace_urgent_seconds';

-- 2) Per-order expiry registry (tiny; only live acceptance timers)
CREATE TABLE IF NOT EXISTS public.order_acceptance_expiry (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  fire_at timestamptz NOT NULL,
  cron_job_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_acceptance_expiry_fire_at
  ON public.order_acceptance_expiry (fire_at);

ALTER TABLE public.order_acceptance_expiry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_acceptance_expiry FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_acceptance_expiry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_acceptance_expiry TO postgres;

-- UI / realtime helpers (not used by a scan cron)
CREATE INDEX IF NOT EXISTS idx_orders_placed_auto_cancel_at
  ON public.orders (auto_cancel_at)
  WHERE status = 'placed' AND auto_cancel_at IS NOT NULL;

-- 3) Helpers: cron job name + timeout seconds
CREATE OR REPLACE FUNCTION public._order_acceptance_cron_name(_order_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'oae_' || replace(_order_id::text, '-', '');
$$;

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

  IF v IS NULL OR v < 30 OR v > 3600 THEN
    RETURN 300;
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 300;
END;
$$;

-- 4) O(1) cancel by order id — shared path for edge + one-shot cron
CREATE OR REPLACE FUNCTION public.expire_unaccepted_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job text := public._order_acceptance_cron_name(_order_id);
  v_updated uuid;
  v_fire_at timestamptz;
  v_order_deadline timestamptz;
  v_status public.order_status;
  v_auto_accepted boolean;
BEGIN
  SELECT fire_at INTO v_fire_at
  FROM public.order_acceptance_expiry
  WHERE order_id = _order_id;

  SELECT o.status, o.auto_accepted, o.auto_cancel_at
  INTO v_status, v_auto_accepted, v_order_deadline
  FROM public.orders o
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    PERFORM public.clear_order_acceptance_expiry(_order_id);
    RETURN jsonb_build_object('cancelled', false, 'reason', 'not_found', 'order_id', _order_id);
  END IF;

  v_fire_at := COALESCE(v_fire_at, v_order_deadline);

  -- Never cancel early
  IF v_fire_at IS NOT NULL AND v_fire_at > now() THEN
    RETURN jsonb_build_object(
      'cancelled', false,
      'reason', 'not_yet_due',
      'order_id', _order_id,
      'fire_at', v_fire_at
    );
  END IF;

  IF v_status IS DISTINCT FROM 'placed'::public.order_status
     OR COALESCE(v_auto_accepted, false) = true THEN
    PERFORM public.clear_order_acceptance_expiry(_order_id);
    UPDATE public.orders
    SET auto_cancel_at = NULL, updated_at = now()
    WHERE id = _order_id AND auto_cancel_at IS NOT NULL;
    RETURN jsonb_build_object('cancelled', false, 'reason', 'not_eligible', 'order_id', _order_id);
  END IF;

  PERFORM set_config('app.acting_as', 'system', true);

  UPDATE public.orders o
  SET
    status = 'cancelled'::public.order_status,
    rejection_reason = 'We couldn''t confirm your order as the seller didn''t respond in time',
    failure_owner = COALESCE(o.failure_owner, 'seller'),
    auto_cancel_at = NULL,
    updated_at = now()
  WHERE o.id = _order_id
    AND o.status = 'placed'::public.order_status
    AND COALESCE(o.auto_accepted, false) = false
  RETURNING o.id INTO v_updated;

  PERFORM public.clear_order_acceptance_expiry(_order_id);

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'not_eligible', 'order_id', _order_id);
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true,
    'order_id', v_updated,
    'reason', 'seller_acceptance_timeout'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unaccepted_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unaccepted_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_unaccepted_order(uuid) TO postgres;

-- 5) Unschedule / clear timer for one order
CREATE OR REPLACE FUNCTION public.clear_order_acceptance_expiry(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job text := public._order_acceptance_cron_name(_order_id);
BEGIN
  DELETE FROM public.order_acceptance_expiry WHERE order_id = _order_id;

  BEGIN
    PERFORM cron.unschedule(v_job);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_order_acceptance_expiry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_order_acceptance_expiry(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_order_acceptance_expiry(uuid) TO postgres;

-- 6) Schedule one-shot durable cron + edge waitUntil invoke (exact 5m)
CREATE OR REPLACE FUNCTION public.schedule_order_acceptance_expiry(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order record;
  v_timeout int := public._order_acceptance_timeout_seconds();
  v_fire_at timestamptz;
  v_job text := public._order_acceptance_cron_name(_order_id);
  v_cron_at timestamptz;
  v_schedule text;
  v_url text;
  v_anon text;
BEGIN
  SELECT id, status, auto_accepted, auto_cancel_at
  INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('scheduled', false, 'reason', 'not_found');
  END IF;

  IF v_order.status IS DISTINCT FROM 'placed'::public.order_status
     OR COALESCE(v_order.auto_accepted, false) = true THEN
    PERFORM public.clear_order_acceptance_expiry(_order_id);
    RETURN jsonb_build_object('scheduled', false, 'reason', 'not_placed');
  END IF;

  -- Keep an already-stamped future deadline (e.g. preorder 30m); else exactly timeout
  IF v_order.auto_cancel_at IS NOT NULL AND v_order.auto_cancel_at > now() THEN
    v_fire_at := v_order.auto_cancel_at;
  ELSE
    v_fire_at := now() + make_interval(secs => v_timeout);
  END IF;

  UPDATE public.orders
  SET auto_cancel_at = v_fire_at,
      updated_at = now()
  WHERE id = _order_id
    AND status = 'placed'::public.order_status;

  -- Replace any prior schedule for this order
  PERFORM public.clear_order_acceptance_expiry(_order_id);

  -- Durable one-shot cron: fire at/after deadline minute (never early)
  v_cron_at := date_trunc('minute', v_fire_at) + interval '1 minute';
  v_schedule := to_char(v_cron_at AT TIME ZONE 'UTC', 'MI HH24 DD MM *');

  BEGIN
    PERFORM cron.schedule(
      v_job,
      v_schedule,
      format(
        $cmd$SELECT public.expire_unaccepted_order(%L::uuid);$cmd$,
        _order_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Cron may already exist; try replace
    BEGIN
      PERFORM cron.unschedule(v_job);
      PERFORM cron.schedule(
        v_job,
        v_schedule,
        format(
          $cmd$SELECT public.expire_unaccepted_order(%L::uuid);$cmd$,
          _order_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'schedule_order_acceptance_expiry cron failed for %: %', _order_id, SQLERRM;
    END;
  END;

  INSERT INTO public.order_acceptance_expiry (order_id, fire_at, cron_job_name)
  VALUES (_order_id, v_fire_at, v_job)
  ON CONFLICT (order_id) DO UPDATE
  SET fire_at = EXCLUDED.fire_at,
      cron_job_name = EXCLUDED.cron_job_name,
      created_at = now();

  -- Exact-timing path: edge waits until fire_at then cancels by id
  v_url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/expire-unaccepted-order';
  v_anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA';

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      body := jsonb_build_object(
        'order_id', _order_id,
        'trigger', 'acceptance_schedule',
        'time', now()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'schedule_order_acceptance_expiry edge invoke failed for %: %', _order_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'scheduled', true,
    'order_id', _order_id,
    'fire_at', v_fire_at,
    'cron_job_name', v_job,
    'cron_at', v_cron_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_order_acceptance_expiry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_order_acceptance_expiry(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_order_acceptance_expiry(uuid) TO postgres;

-- 7) Triggers: schedule on enter placed; clear on leave placed
CREATE OR REPLACE FUNCTION public.fn_trg_schedule_order_acceptance_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'placed'::public.order_status
     AND COALESCE(NEW.auto_accepted, false) = false THEN
    IF TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'placed'::public.order_status THEN
      PERFORM public.schedule_order_acceptance_expiry(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_order_acceptance_expiry ON public.orders;
CREATE TRIGGER trg_schedule_order_acceptance_expiry
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_schedule_order_acceptance_expiry();

CREATE OR REPLACE FUNCTION public.fn_trg_clear_order_acceptance_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'placed'::public.order_status
     AND NEW.status IS DISTINCT FROM 'placed'::public.order_status THEN
    PERFORM public.clear_order_acceptance_expiry(NEW.id);
    IF NEW.auto_cancel_at IS NOT NULL THEN
      NEW.auto_cancel_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE so we can null auto_cancel_at on the same row update
DROP TRIGGER IF EXISTS trg_clear_order_acceptance_expiry ON public.orders;
CREATE TRIGGER trg_clear_order_acceptance_expiry
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status = 'placed'::public.order_status
        AND NEW.status IS DISTINCT FROM 'placed'::public.order_status)
  EXECUTE FUNCTION public.fn_trg_clear_order_acceptance_expiry();

-- 8) Auto-accept must also cover payment_pending → placed (online)
CREATE OR REPLACE FUNCTION public.handle_order_auto_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller RECORD;
  v_today_count int;
  v_current_day text;
BEGIN
  -- Newly actionable for seller
  IF NEW.status IS DISTINCT FROM 'placed'::public.order_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'placed'::public.order_status THEN
    RETURN NEW;
  END IF;

  SELECT auto_accept_enabled, operating_days, availability_start, availability_end, daily_order_limit
  INTO v_seller
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF NOT FOUND OR NOT v_seller.auto_accept_enabled THEN
    RETURN NEW;
  END IF;

  v_current_day := lower(trim(to_char(now() AT TIME ZONE 'Asia/Kolkata', 'Day')));
  IF v_seller.operating_days IS NOT NULL AND array_length(v_seller.operating_days, 1) > 0 THEN
    IF NOT (v_current_day = ANY(v_seller.operating_days)) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.availability_start IS NOT NULL AND v_seller.availability_end IS NOT NULL THEN
    IF (now() AT TIME ZONE 'Asia/Kolkata')::time < v_seller.availability_start
       OR (now() AT TIME ZONE 'Asia/Kolkata')::time > v_seller.availability_end THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.daily_order_limit IS NOT NULL AND v_seller.daily_order_limit > 0 THEN
    SELECT count(*) INTO v_today_count
    FROM public.orders
    WHERE seller_id = NEW.seller_id
      AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status NOT IN ('cancelled', 'returned');

    IF v_today_count >= v_seller.daily_order_limit THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.status := 'preparing';
  NEW.auto_accepted := true;
  NEW.auto_cancel_at := NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_auto_accept ON public.orders;
CREATE TRIGGER trg_order_auto_accept
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_auto_accept();

DROP TRIGGER IF EXISTS trg_log_auto_accept_activity ON public.orders;
CREATE TRIGGER trg_log_auto_accept_activity
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.auto_accepted = true)
  EXECUTE FUNCTION public.log_auto_accept_activity();

DROP TRIGGER IF EXISTS trg_log_auto_accept_activity_upd ON public.orders;
CREATE TRIGGER trg_log_auto_accept_activity_upd
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.auto_accepted = true AND OLD.auto_accepted IS DISTINCT FROM true)
  EXECUTE FUNCTION public.log_auto_accept_activity();

-- 9) Nudge windows compressed into the 5-minute acceptance SLA
UPDATE public.notification_rules
SET delay_seconds = 60,
    description = 'Soft nudge after 1 minute (5m acceptance SLA)',
    updated_at = now()
WHERE key = 'order_placed_seller_l1';

UPDATE public.notification_rules
SET delay_seconds = 180,
    description = 'Warning at 3 minutes (5m acceptance SLA)',
    updated_at = now()
WHERE key = 'order_placed_seller_l2';

UPDATE public.notification_rules
SET delay_seconds = 240,
    description = 'Urgent at 4 minutes — cancels in ~1 minute',
    updated_at = now()
WHERE key = 'order_placed_seller_l3';

UPDATE public.notification_rules
SET active = false,
    description = 'Disabled: hard cancel now at 5 minutes (was 28m final warning)',
    updated_at = now()
WHERE key = 'order_placed_seller_l4';

UPDATE public.notification_templates
SET body_template = 'Accept now or this order will be auto-cancelled in about 1 minute.',
    updated_at = now()
WHERE key = 'order_placed_seller_l3';

-- 10) Backfill: schedule expiry for currently placed, unaccepted orders
DO $$
DECLARE
  r record;
  v_timeout int := public._order_acceptance_timeout_seconds();
  v_fire timestamptz;
BEGIN
  FOR r IN
    SELECT id, created_at, status_changed_at, auto_cancel_at
    FROM public.orders
    WHERE status = 'placed'::public.order_status
      AND COALESCE(auto_accepted, false) = false
  LOOP
    v_fire := COALESCE(
      NULLIF(r.auto_cancel_at, NULL),
      COALESCE(r.status_changed_at, r.created_at) + make_interval(secs => v_timeout)
    );

    -- If already past deadline, cancel immediately by id
    IF v_fire <= now() THEN
      UPDATE public.orders
      SET auto_cancel_at = v_fire
      WHERE id = r.id AND status = 'placed'::public.order_status;
      PERFORM public.expire_unaccepted_order(r.id);
    ELSE
      UPDATE public.orders
      SET auto_cancel_at = v_fire
      WHERE id = r.id AND status = 'placed'::public.order_status;
      PERFORM public.schedule_order_acceptance_expiry(r.id);
    END IF;
  END LOOP;
END $$;
