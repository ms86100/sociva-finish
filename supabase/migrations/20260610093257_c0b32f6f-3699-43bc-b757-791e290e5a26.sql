
-- 1. Table
CREATE TABLE IF NOT EXISTS public.scheduled_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('order','delivery')),
  entity_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.notification_rules(id) ON DELETE CASCADE,
  fire_at timestamptz NOT NULL,
  fired_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, rule_id)
);

GRANT SELECT ON public.scheduled_reminders TO authenticated;
GRANT ALL ON public.scheduled_reminders TO service_role;

ALTER TABLE public.scheduled_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scheduled reminders"
ON public.scheduled_reminders FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_due
  ON public.scheduled_reminders (fire_at)
  WHERE fired_at IS NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_entity
  ON public.scheduled_reminders (entity_type, entity_id);

-- 2. Trigger: schedule order reminders on insert/status change
CREATE OR REPLACE FUNCTION public.fn_schedule_order_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cancel any pending reminders from the previous status
  UPDATE public.scheduled_reminders
     SET canceled_at = now()
   WHERE entity_type = 'order'
     AND entity_id = NEW.id
     AND fired_at IS NULL
     AND canceled_at IS NULL;

  -- Schedule reminders for the new status
  INSERT INTO public.scheduled_reminders (entity_type, entity_id, rule_id, fire_at)
  SELECT 'order', NEW.id, r.id,
         COALESCE(NEW.status_changed_at, now()) + make_interval(secs => r.delay_seconds)
  FROM public.notification_rules r
  WHERE r.active = true
    AND r.entity_type = 'order'
    AND r.trigger_status = NEW.status::text
  ON CONFLICT (entity_id, rule_id) DO UPDATE
    SET fire_at     = EXCLUDED.fire_at,
        fired_at    = NULL,
        canceled_at = NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_order_reminders_ins ON public.orders;
CREATE TRIGGER trg_schedule_order_reminders_ins
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_order_reminders();

DROP TRIGGER IF EXISTS trg_schedule_order_reminders_upd ON public.orders;
CREATE TRIGGER trg_schedule_order_reminders_upd
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_schedule_order_reminders();

-- 3. Trigger: schedule delivery reminders on stall_level change
CREATE OR REPLACE FUNCTION public.fn_schedule_delivery_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE public.scheduled_reminders
     SET canceled_at = now()
   WHERE entity_type = 'delivery'
     AND entity_id = NEW.id
     AND fired_at IS NULL
     AND canceled_at IS NULL;

  IF NEW.stall_level IS NULL OR NEW.stall_level < 1 THEN
    RETURN NEW;
  END IF;

  v_status := 'stall_' || NEW.stall_level::text;

  INSERT INTO public.scheduled_reminders (entity_type, entity_id, rule_id, fire_at)
  SELECT 'delivery', NEW.id, r.id,
         COALESCE(NEW.stall_changed_at, NEW.updated_at, now()) + make_interval(secs => r.delay_seconds)
  FROM public.notification_rules r
  WHERE r.active = true
    AND r.entity_type = 'delivery'
    AND r.trigger_status = v_status
  ON CONFLICT (entity_id, rule_id) DO UPDATE
    SET fire_at     = EXCLUDED.fire_at,
        fired_at    = NULL,
        canceled_at = NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_delivery_reminders_ins ON public.delivery_assignments;
CREATE TRIGGER trg_schedule_delivery_reminders_ins
  AFTER INSERT ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_delivery_reminders();

DROP TRIGGER IF EXISTS trg_schedule_delivery_reminders_upd ON public.delivery_assignments;
CREATE TRIGGER trg_schedule_delivery_reminders_upd
  AFTER UPDATE OF stall_level ON public.delivery_assignments
  FOR EACH ROW
  WHEN (OLD.stall_level IS DISTINCT FROM NEW.stall_level)
  EXECUTE FUNCTION public.fn_schedule_delivery_reminders();

-- 4. Worker: fire due reminders
CREATE OR REPLACE FUNCTION public.fn_fire_due_reminders(_batch int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_target uuid;
  v_order record;
  v_assign record;
  v_order_short text;
  v_item_summary text;
  v_item_count int;
  v_count int := 0;
  v_current_status text;
BEGIN
  FOR r IN
    SELECT sr.id          AS sr_id,
           sr.entity_type,
           sr.entity_id,
           sr.rule_id,
           nr.target_actor,
           nr.trigger_status
      FROM public.scheduled_reminders sr
      JOIN public.notification_rules nr ON nr.id = sr.rule_id
     WHERE sr.fire_at <= now()
       AND sr.fired_at IS NULL
       AND sr.canceled_at IS NULL
       AND nr.active = true
     ORDER BY sr.fire_at
     LIMIT _batch
     FOR UPDATE OF sr SKIP LOCKED
  LOOP
    v_target := NULL;

    IF r.entity_type = 'order' THEN
      SELECT id, buyer_id, seller_id, status::text AS status
        INTO v_order
        FROM public.orders
       WHERE id = r.entity_id;

      IF NOT FOUND OR v_order.status <> r.trigger_status THEN
        UPDATE public.scheduled_reminders SET canceled_at = now() WHERE id = r.sr_id;
        CONTINUE;
      END IF;

      IF r.target_actor = 'buyer' THEN
        v_target := v_order.buyer_id;
      ELSIF r.target_actor = 'seller' THEN
        SELECT user_id INTO v_target
          FROM public.seller_profiles
         WHERE id = v_order.seller_id;
      END IF;

      v_order_short := upper(substring(v_order.id::text from 1 for 8));
      SELECT COALESCE(SUM(quantity), 0)::int,
             COALESCE(string_agg(quantity::text || 'x ' || product_name, ', '), '')
        INTO v_item_count, v_item_summary
        FROM public.order_items
       WHERE order_id = v_order.id;

      IF v_target IS NOT NULL THEN
        PERFORM public.fn_enqueue_from_rule(
          r.rule_id,
          v_order.id,
          v_target,
          jsonb_build_object(
            'order_short', v_order_short,
            'order_id',    v_order.id::text,
            'item_summary', v_item_summary,
            'item_count',  v_item_count::text
          ),
          '/orders/' || v_order.id::text
        );
        v_count := v_count + 1;
      END IF;

    ELSIF r.entity_type = 'delivery' THEN
      SELECT da.id, da.order_id, o.buyer_id, o.seller_id,
             ('stall_' || da.stall_level::text) AS stall_status
        INTO v_assign
        FROM public.delivery_assignments da
        JOIN public.orders o ON o.id = da.order_id
       WHERE da.id = r.entity_id;

      IF NOT FOUND OR v_assign.stall_status <> r.trigger_status THEN
        UPDATE public.scheduled_reminders SET canceled_at = now() WHERE id = r.sr_id;
        CONTINUE;
      END IF;

      IF r.target_actor = 'buyer' THEN
        v_target := v_assign.buyer_id;
      ELSIF r.target_actor = 'seller' THEN
        SELECT user_id INTO v_target
          FROM public.seller_profiles
         WHERE id = v_assign.seller_id;
      END IF;

      v_order_short := upper(substring(v_assign.order_id::text from 1 for 8));
      IF v_target IS NOT NULL THEN
        PERFORM public.fn_enqueue_from_rule(
          r.rule_id,
          v_assign.id,
          v_target,
          jsonb_build_object(
            'order_short', v_order_short,
            'order_id',    v_assign.order_id::text
          ),
          '/orders/' || v_assign.order_id::text
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    UPDATE public.scheduled_reminders SET fired_at = now() WHERE id = r.sr_id;
  END LOOP;

  IF v_count > 0 THEN
    PERFORM net.http_post(
      url     := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
      body    := '{}'::jsonb
    );
  END IF;

  RETURN v_count;
END;
$$;

-- 5. Backfill for currently open orders + delivery assignments
INSERT INTO public.scheduled_reminders (entity_type, entity_id, rule_id, fire_at)
SELECT 'order', o.id, r.id,
       COALESCE(o.status_changed_at, o.created_at, now()) + make_interval(secs => r.delay_seconds)
  FROM public.orders o
  JOIN public.notification_rules r
    ON r.active = true
   AND r.entity_type = 'order'
   AND r.trigger_status = o.status::text
ON CONFLICT (entity_id, rule_id) DO NOTHING;

INSERT INTO public.scheduled_reminders (entity_type, entity_id, rule_id, fire_at)
SELECT 'delivery', da.id, r.id,
       COALESCE(da.stall_changed_at, da.updated_at, now()) + make_interval(secs => r.delay_seconds)
  FROM public.delivery_assignments da
  JOIN public.notification_rules r
    ON r.active = true
   AND r.entity_type = 'delivery'
   AND r.trigger_status = 'stall_' || da.stall_level::text
 WHERE da.stall_level IS NOT NULL AND da.stall_level >= 1
ON CONFLICT (entity_id, rule_id) DO NOTHING;

-- 6. Cron: replace old engine with lightweight SQL worker
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'notification_engine_every_1m';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'fire_due_reminders_every_1m';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'fire_due_reminders_every_1m',
  '* * * * *',
  $cron$ SELECT public.fn_fire_due_reminders(500); $cron$
);
