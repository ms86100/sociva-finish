-- Order-scoped seller alert acknowledgement audit.
-- Device ringing remains local; this table records cross-channel ack for ops / WhatsApp stop.

CREATE TABLE IF NOT EXISTS public.seller_order_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_id text,
  alert_started_at timestamptz NOT NULL DEFAULT now(),
  alert_acknowledged_at timestamptz,
  alert_status text NOT NULL DEFAULT 'ringing'
    CHECK (alert_status IN ('ringing', 'acknowledged', 'expired', 'cancelled')),
  acknowledgement_source text
    CHECK (
      acknowledgement_source IS NULL OR acknowledgement_source IN (
        'APP_ACCEPT',
        'APP_REJECT',
        'NOTIFICATION_OPEN',
        'WHATSAPP_ACCEPT',
        'WHATSAPP_REJECT',
        'ORDER_CANCELLED',
        'ORDER_EXPIRED',
        'UNKNOWN'
      )
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_order_alerts_order_idx
  ON public.seller_order_alerts (order_id, alert_started_at DESC);

CREATE INDEX IF NOT EXISTS seller_order_alerts_ringing_idx
  ON public.seller_order_alerts (order_id)
  WHERE alert_status = 'ringing';

ALTER TABLE public.seller_order_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_order_alerts_service ON public.seller_order_alerts;
CREATE POLICY seller_order_alerts_service ON public.seller_order_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS seller_order_alerts_seller_select ON public.seller_order_alerts;
CREATE POLICY seller_order_alerts_seller_select ON public.seller_order_alerts
  FOR SELECT
  TO authenticated
  USING (
    seller_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE o.id = seller_order_alerts.order_id
        AND sp.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.ack_seller_order_alert(
  p_order_id uuid,
  p_source text DEFAULT 'UNKNOWN'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_source IS NULL OR p_source = '' THEN
    p_source := 'UNKNOWN';
  END IF;

  UPDATE public.seller_order_alerts
  SET alert_status = CASE
        WHEN p_source IN ('ORDER_CANCELLED') THEN 'cancelled'
        WHEN p_source IN ('ORDER_EXPIRED') THEN 'expired'
        ELSE 'acknowledged'
      END,
      alert_acknowledged_at = COALESCE(alert_acknowledged_at, now()),
      acknowledgement_source = p_source,
      updated_at = now()
  WHERE order_id = p_order_id
    AND alert_status = 'ringing';
END;
$function$;

REVOKE ALL ON FUNCTION public.ack_seller_order_alert(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ack_seller_order_alert(uuid, text) TO service_role, authenticated;

COMMENT ON TABLE public.seller_order_alerts IS
  'Per-order seller alert lifecycle. Stopping one order must not ack another.';
