-- Per-device gate for the closed-app Android order alert.
-- Tokens without order_alert_native_v1 stay on the legacy notification payload.
-- Rollback: UPDATE seller_alert_android_config SET mode = 'legacy', updated_at = now() WHERE id = 1;

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS app_version_name text,
  ADD COLUMN IF NOT EXISTS app_version_code integer,
  ADD COLUMN IF NOT EXISTS alert_capability text,
  ADD COLUMN IF NOT EXISTS capability_reported_at timestamptz;

COMMENT ON COLUMN public.device_tokens.alert_capability IS
  'order_alert_native_v1 means this install contains OrderAlertMessagingService. Null means keep the legacy FCM notification.';

CREATE TABLE IF NOT EXISTS public.seller_alert_android_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'version_gated' CHECK (mode IN ('legacy', 'version_gated')),
  min_version_code integer NOT NULL DEFAULT 67 CHECK (min_version_code > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seller_alert_android_config (id, mode, min_version_code)
VALUES (1, 'version_gated', 67)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.seller_alert_android_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seller_alert_android_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.seller_alert_android_config TO service_role;

CREATE OR REPLACE FUNCTION public.stamp_device_token_client_build(
  p_token text,
  p_app_version_code integer,
  p_app_version_name text,
  p_alert_capability text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN;
  END IF;

  UPDATE public.device_tokens
  SET
    app_version_code = p_app_version_code,
    app_version_name = left(COALESCE(p_app_version_name, ''), 32),
    alert_capability = CASE
      WHEN p_alert_capability = 'order_alert_native_v1' THEN 'order_alert_native_v1'
      ELSE NULL
    END,
    capability_reported_at = CASE
      WHEN p_alert_capability = 'order_alert_native_v1' THEN now()
      ELSE capability_reported_at
    END,
    updated_at = now()
  WHERE user_id = auth.uid()
    AND token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_device_token_client_build(text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_device_token_client_build(text, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_seller_alert_android_mode(
  p_mode text,
  p_min_version_code integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_mode NOT IN ('legacy', 'version_gated') THEN
    RAISE EXCEPTION 'mode must be legacy or version_gated';
  END IF;
  UPDATE public.seller_alert_android_config
  SET
    mode = p_mode,
    min_version_code = COALESCE(p_min_version_code, min_version_code),
    updated_at = now()
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_seller_alert_android_mode(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_seller_alert_android_mode(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_alert_upgrade_report()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT min_version_code INTO v_min FROM public.seller_alert_android_config WHERE id = 1;

  RETURN jsonb_build_object(
    'mode', (SELECT mode FROM public.seller_alert_android_config WHERE id = 1),
    'min_version_code', v_min,
    'android_tokens', (
      SELECT count(*) FROM public.device_tokens
      WHERE platform = 'android' AND COALESCE(invalid, false) = false
    ),
    'verified_native_tokens', (
      SELECT count(*) FROM public.device_tokens
      WHERE platform = 'android'
        AND COALESCE(invalid, false) = false
        AND alert_capability = 'order_alert_native_v1'
        AND app_version_code >= v_min
    ),
    'unconfirmed_android_tokens', (
      SELECT count(*) FROM public.device_tokens
      WHERE platform = 'android'
        AND COALESCE(invalid, false) = false
        AND (
          alert_capability IS DISTINCT FROM 'order_alert_native_v1'
          OR app_version_code IS NULL
          OR app_version_code < v_min
        )
    ),
    'open_failure_rows_7d', (
      SELECT count(*) FROM public.notification_failures
      WHERE created_at > now() - interval '7 days'
    ),
    'blocked_queue_rows', (
      SELECT count(*) FROM public.notification_queue WHERE status = 'blocked'
    ),
    'recent_failure_order_ids', (
      SELECT COALESCE(jsonb_agg(order_id), '[]'::jsonb)
      FROM (
        SELECT order_id
        FROM public.notification_failures
        WHERE order_id IS NOT NULL
          AND created_at > now() - interval '2 days'
        ORDER BY created_at DESC
        LIMIT 30
      ) recent
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_alert_upgrade_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_alert_upgrade_report() TO authenticated;
