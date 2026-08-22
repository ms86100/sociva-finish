-- Scheduled order lifecycle: computed times, transitions, reminders, seller accept → scheduled.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS preparation_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_fulfilment_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_cutoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.orders.preparation_start_at IS 'When seller should begin prep (scheduled fulfilment minus prep window).';
COMMENT ON COLUMN public.orders.scheduled_fulfilment_at IS 'Canonical scheduled fulfilment instant (IST date + time).';
COMMENT ON COLUMN public.orders.cancellation_cutoff_at IS 'Buyer cancellation allowed until this instant.';
COMMENT ON COLUMN public.orders.reminder_state IS 'Idempotency flags for scheduled-order reminder jobs.';

CREATE OR REPLACE FUNCTION public.compute_scheduled_order_times(
  p_scheduled_date date,
  p_scheduled_time time,
  p_prep_minutes int DEFAULT 60,
  p_cancel_hours int DEFAULT 24
)
RETURNS TABLE (
  scheduled_fulfilment_at timestamptz,
  preparation_start_at timestamptz,
  cancellation_cutoff_at timestamptz
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata' AS scheduled_fulfilment_at,
    ((p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata')
      - make_interval(mins => GREATEST(COALESCE(p_prep_minutes, 60), 15)) AS preparation_start_at,
    ((p_scheduled_date + COALESCE(p_scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata')
      - make_interval(hours => GREATEST(COALESCE(p_cancel_hours, 24), 1)) AS cancellation_cutoff_at
  WHERE p_scheduled_date IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_compute_scheduled_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_times record;
BEGIN
  IF NEW.scheduled_date IS NULL THEN
    NEW.preparation_start_at := NULL;
    NEW.scheduled_fulfilment_at := NULL;
    NEW.cancellation_cutoff_at := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_times
  FROM public.compute_scheduled_order_times(
    NEW.scheduled_date,
    COALESCE(NEW.scheduled_time_start, NEW.scheduled_time, time '12:00')
  );

  NEW.scheduled_fulfilment_at := v_times.scheduled_fulfilment_at;
  NEW.preparation_start_at := v_times.preparation_start_at;
  NEW.cancellation_cutoff_at := v_times.cancellation_cutoff_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_compute_scheduled_times ON public.orders;
CREATE TRIGGER trg_orders_compute_scheduled_times
  BEFORE INSERT OR UPDATE OF scheduled_date, scheduled_time_start, scheduled_time
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_compute_scheduled_times();

-- Backfill computed times for existing scheduled orders
UPDATE public.orders
SET
  scheduled_fulfilment_at = (scheduled_date + COALESCE(scheduled_time_start, scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata',
  preparation_start_at = ((scheduled_date + COALESCE(scheduled_time_start, scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata') - interval '60 minutes',
  cancellation_cutoff_at = ((scheduled_date + COALESCE(scheduled_time_start, scheduled_time, time '12:00')) AT TIME ZONE 'Asia/Kolkata') - interval '24 hours'
WHERE scheduled_date IS NOT NULL;

-- Cart / delivery scheduled transitions (default parent group)
INSERT INTO public.category_status_transitions (parent_group, transaction_type, from_status, to_status, allowed_actor)
SELECT v.parent_group, v.transaction_type, v.from_status, v.to_status, v.allowed_actor
FROM (VALUES
  ('default', 'cart_purchase', 'placed', 'scheduled', 'seller'),
  ('default', 'cart_purchase', 'accepted', 'scheduled', 'seller'),
  ('default', 'cart_purchase', 'confirmed', 'scheduled', 'seller'),
  ('default', 'cart_purchase', 'scheduled', 'preparing', 'seller'),
  ('default', 'cart_purchase', 'scheduled', 'cancelled', 'buyer'),
  ('default', 'cart_purchase', 'scheduled', 'cancelled', 'seller'),
  ('default', 'seller_delivery', 'placed', 'scheduled', 'seller'),
  ('default', 'seller_delivery', 'accepted', 'scheduled', 'seller'),
  ('default', 'seller_delivery', 'confirmed', 'scheduled', 'seller'),
  ('default', 'seller_delivery', 'scheduled', 'preparing', 'seller'),
  ('default', 'seller_delivery', 'scheduled', 'cancelled', 'buyer'),
  ('default', 'seller_delivery', 'scheduled', 'cancelled', 'seller'),
  ('default', 'self_fulfillment', 'placed', 'scheduled', 'seller'),
  ('default', 'self_fulfillment', 'accepted', 'scheduled', 'seller'),
  ('default', 'self_fulfillment', 'scheduled', 'preparing', 'seller')
) AS v(parent_group, transaction_type, from_status, to_status, allowed_actor)
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_status_transitions existing
  WHERE existing.parent_group = v.parent_group
    AND existing.transaction_type = v.transaction_type
    AND existing.from_status = v.from_status
    AND existing.to_status = v.to_status
    AND existing.allowed_actor = v.allowed_actor
);

-- Accepting a future-dated order → status scheduled (not accepted/preparing path)
CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
  v_updated_id uuid;
  v_final_status order_status;
  v_target_status order_status;
  v_today_ist date;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         o.scheduled_date, o.scheduled_fulfilment_at, o.preparation_start_at,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_target_status := _new_status;
  v_today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF _new_status IN ('accepted', 'confirmed')
     AND v_order.scheduled_date IS NOT NULL
     AND v_order.scheduled_date > v_today_ist
     AND (v_order.preparation_start_at IS NULL OR v_order.preparation_start_at > now()) THEN
    v_target_status := 'scheduled';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery') THEN v_transaction_type := 'seller_delivery';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = v_target_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, v_target_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = v_target_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN v_target_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = CASE
        WHEN v_target_status = 'scheduled' THEN NULL
        ELSE auto_cancel_at
      END
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_status;
END;
$function$;

-- Upcoming scheduled orders for seller or buyer dashboards
CREATE OR REPLACE FUNCTION public.get_upcoming_scheduled_orders(
  p_seller_id uuid DEFAULT NULL,
  p_buyer_id uuid DEFAULT NULL,
  p_from_date date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_to_date date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 60)
)
RETURNS SETOF public.orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.*
  FROM public.orders o
  WHERE o.scheduled_date IS NOT NULL
    AND o.scheduled_date BETWEEN p_from_date AND p_to_date
    AND o.status IN (
      'placed', 'pending', 'accepted', 'confirmed', 'scheduled',
      'requested', 'rescheduled'
    )
    AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
    AND (p_buyer_id IS NULL OR o.buyer_id = p_buyer_id)
    AND (
      p_seller_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.seller_profiles sp
        WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
      )
      OR p_buyer_id IS NOT NULL AND p_buyer_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
    )
  ORDER BY o.scheduled_date ASC,
           COALESCE(o.scheduled_time_start, o.scheduled_time, time '12:00') ASC;
$$;

REVOKE ALL ON FUNCTION public.get_upcoming_scheduled_orders(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_upcoming_scheduled_orders(uuid, uuid, date, date) TO authenticated;

-- Cron helper: invoke scheduled-order reminders edge function
CREATE OR REPLACE FUNCTION public.fn_invoke_scheduled_order_reminders(p_trigger text DEFAULT 'cron')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
BEGIN
  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/send-scheduled-order-reminders';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_scheduled_order_reminders: pnq_worker_secret missing — skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('trigger', p_trigger, 'time', now())
  );
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'send_scheduled_order_reminders_hourly'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'send_scheduled_order_reminders_hourly',
  '15 * * * *',
  $$SELECT public.fn_invoke_scheduled_order_reminders('cron');$$
);
