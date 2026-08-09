-- Performance P0: stop per-row PNQ HTTP storms + hot-path RLS initplan fixes.
-- Preserves notification delivery via PNQ self-schedule + orphan recovery;
-- this only reduces redundant Edge wake-ups that saturate the DB pool.

-- -- 1. Debounce gate (singleton) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public._pnq_wakeup_gate (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_wakeup_at timestamptz NOT NULL DEFAULT 'epoch'
);

INSERT INTO public._pnq_wakeup_gate (id, last_wakeup_at)
VALUES (1, 'epoch')
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE public._pnq_wakeup_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public._pnq_wakeup_gate TO postgres, service_role;

COMMENT ON TABLE public._pnq_wakeup_gate IS
  'Internal debounce for process-notification-queue wake-ups. Not client-facing.';

-- -- 2. Debounced PNQ wake-up (=1 HTTP per txn + =2s cross-txn gap) -----------
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
BEGIN
  -- Multi-row INSERT in one transaction ? only first row may wake PNQ
  IF NOT pg_try_advisory_xact_lock(87201401) THEN
    RETURN NEW;
  END IF;

  -- Cross-transaction debounce (status storms / multi-vendor back-to-back)
  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '2 seconds'
  RETURNING true INTO did_claim;

  IF NOT COALESCE(did_claim, false) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA'
    ),
    body := jsonb_build_object('trigger', 'insert_debounced', 'time', now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.push_logs (user_id, level, message, metadata)
    VALUES (
      NEW.user_id,
      'error',
      'trigger_process_notification_queue net.http_post failed',
      jsonb_build_object('queue_id', NEW.id, 'sqlerrm', SQLERRM)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trigger_process_notification_queue() IS
  'Debounced best-effort wake-up for process-notification-queue. At most one HTTP per transaction and at most one every 2s. PNQ claim/self-schedule covers backlog.';

-- Keep FOR EACH ROW trigger (behavior-compatible); body is now debounced.
DROP TRIGGER IF EXISTS trg_process_notification_queue ON public.notification_queue;
CREATE TRIGGER trg_process_notification_queue
  AFTER INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_process_notification_queue();

-- -- 3. Safety cron: wake PNQ if pending rows sit idle (missed debounce) ------
CREATE OR REPLACE FUNCTION public.fn_wakeup_notification_queue_if_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  ) THEN
    RETURN;
  END IF;

  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '15 seconds'
  RETURNING true INTO did_claim;

  IF NOT COALESCE(did_claim, false) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA'
    ),
    body := jsonb_build_object('trigger', 'cron_pending_safety', 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_wakeup_notification_queue_if_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_wakeup_notification_queue_if_pending() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wakeup_notification_queue_if_pending') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'wakeup_notification_queue_if_pending' LIMIT 1));
  END IF;
END $$;

SELECT cron.schedule(
  'wakeup_notification_queue_if_pending',
  '*/2 * * * *',
  $$SELECT public.fn_wakeup_notification_queue_if_pending();$$
);

-- -- 4. Hot-path RLS: wrap auth.uid() / is_admin() in (select ...) ------------
-- Same predicates — only InitPlan caching changes (advisor auth_rls_initplan).

DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;
CREATE POLICY "Users can view their own orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    (buyer_id = (select auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.seller_profiles
      WHERE seller_profiles.id = orders.seller_id
        AND seller_profiles.user_id = (select auth.uid())
    ))
    OR public.is_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "Buyers and sellers can update orders" ON public.orders;
CREATE POLICY "Buyers and sellers can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    (buyer_id = (select auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.seller_profiles
      WHERE seller_profiles.id = orders.seller_id
        AND seller_profiles.user_id = (select auth.uid())
    ))
    OR public.is_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "Authenticated users can create orders" ON public.orders;
CREATE POLICY "Authenticated users can create orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can view order items for their orders" ON public.order_items;
CREATE POLICY "Users can view order items for their orders"
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM public.orders
      WHERE orders.id = order_items.order_id
        AND (
          orders.buyer_id = (select auth.uid())
          OR (EXISTS (
            SELECT 1
            FROM public.seller_profiles
            WHERE seller_profiles.id = orders.seller_id
              AND seller_profiles.user_id = (select auth.uid())
          ))
        )
    ))
    OR public.is_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (
    (user_id = (select auth.uid()))
    OR public.is_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
CREATE POLICY "Users can view own notifications"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.user_notifications;
CREATE POLICY "Users can update own notifications"
  ON public.user_notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "own_read_notif_queue" ON public.notification_queue;
CREATE POLICY "own_read_notif_queue"
  ON public.notification_queue
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- -- 5. Hot index for unpaid auto-cancel cron ---------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_auto_cancel_pending
  ON public.orders (auto_cancel_at)
  WHERE status = 'payment_pending' AND auto_cancel_at IS NOT NULL;
