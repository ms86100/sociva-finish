-- Seller notification reliability remediations from the 2026-10-24 audit.
-- Keep v2 Android payloads for unstamped tokens. Do not drop legacy channels.

-- 1. Stamp must report how many rows were updated, and Android capability
--    must land on this user's Android tokens even if the exact FCM string races.
DROP FUNCTION IF EXISTS public.stamp_device_token_client_build(text, integer, text, text);

CREATE FUNCTION public.stamp_device_token_client_build(
  p_token text,
  p_app_version_code integer,
  p_app_version_name text,
  p_alert_capability text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN jsonb_build_object('updated', 0, 'reason', 'token_too_short');
  END IF;

  UPDATE public.device_tokens
  SET
    app_version_code = COALESCE(p_app_version_code, app_version_code),
    app_version_name = left(COALESCE(p_app_version_name, app_version_name, ''), 32),
    alert_capability = CASE
      WHEN p_alert_capability = 'order_alert_native_v1' THEN 'order_alert_native_v1'
      ELSE alert_capability
    END,
    capability_reported_at = CASE
      WHEN p_alert_capability = 'order_alert_native_v1' THEN now()
      ELSE capability_reported_at
    END,
    updated_at = now()
  WHERE user_id = auth.uid()
    AND (
      token = p_token
      OR (
        p_alert_capability = 'order_alert_native_v1'
        AND platform = 'android'
        AND COALESCE(invalid, false) = false
      )
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_device_token_client_build(text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_device_token_client_build(text, integer, text, text) TO authenticated;

-- 2. Bookings already insert New Booking Confirmed. Skip the product-order
--    item trigger so sellers do not get a second new-order bell.
CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_on_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.order_status;
  v_order_type text;
  v_txn text;
BEGIN
  SELECT o.status, o.order_type, o.transaction_type::text
    INTO v_status, v_order_type, v_txn
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF v_status IS NULL OR v_status IN ('payment_pending', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF v_order_type = 'booking' OR v_txn = 'service_booking' THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_seller_new_order_notification(NEW.order_id);
  RETURN NEW;
END;
$$;

-- 3. Decision: a rescheduled booking is actionable for the seller, so notify
--    them. Keep the RPC New Booking Confirmed path unchanged.
UPDATE public.category_status_flows
SET
  notify_seller = true,
  seller_notification_title = COALESCE(
    NULLIF(seller_notification_title, ''),
    'Appointment rescheduled'
  ),
  seller_notification_body = COALESCE(
    NULLIF(seller_notification_body, ''),
    'A booking was rescheduled. Open Sociva to review the new time.'
  )
WHERE transaction_type = 'service_booking'
  AND status_key = 'rescheduled';

-- 4. Event B prep/30m windows are 10-20 minutes. Hourly cron can miss them.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'send_scheduled_order_reminders_hourly',
      'send_scheduled_order_reminders_every_5m'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'send_scheduled_order_reminders_every_5m',
  '*/5 * * * *',
  $$SELECT public.fn_invoke_scheduled_order_reminders('cron');$$
);
