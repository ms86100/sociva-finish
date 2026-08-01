-- Close remaining delivery production gaps: buyer-safe order actions, delivery feedback,
-- and automated stalled-delivery escalation.

-- 1) Restrict direct order UPDATEs to sellers/admins only.
DROP POLICY IF EXISTS "Buyers and sellers can update orders" ON public.orders;

CREATE POLICY "Sellers and admins can update orders"
ON public.orders
FOR UPDATE
TO public
USING (
  (EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = orders.seller_id
      AND sp.user_id = auth.uid()
  ))
  OR is_admin(auth.uid())
)
WITH CHECK (
  (EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = orders.seller_id
      AND sp.user_id = auth.uid()
  ))
  OR is_admin(auth.uid())
);

-- 2) Buyer-safe RPCs for order actions.
CREATE OR REPLACE FUNCTION public.buyer_cancel_order(
  _order_id uuid,
  _reason text DEFAULT NULL,
  _expected_status public.order_status DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated public.orders;
  _clean_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _clean_reason := left(coalesce(nullif(btrim(_reason), ''), 'Cancelled by buyer'), 500);

  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Cancelled by buyer: ' || _clean_reason,
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = _order_id
    AND buyer_id = auth.uid()
    AND (_expected_status IS NULL OR status = _expected_status)
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.buyer_cancel_order(uuid, text, public.order_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buyer_cancel_order(uuid, text, public.order_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.buyer_mark_order_completed(
  _order_id uuid
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.orders
  SET
    status = 'completed',
    updated_at = now()
  WHERE id = _order_id
    AND buyer_id = auth.uid()
    AND status = 'delivered'
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or not yet delivered';
  END IF;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.buyer_mark_order_completed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buyer_mark_order_completed(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.buyer_cancel_pending_orders(
  _order_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Cancelled by buyer: Payment was not completed',
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = ANY(_order_ids)
    AND buyer_id = auth.uid()
    AND payment_status = 'pending';

  GET DIAGNOSTICS _affected = ROW_COUNT;
  RETURN _affected;
END;
$$;

REVOKE ALL ON FUNCTION public.buyer_cancel_pending_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buyer_cancel_pending_orders(uuid[]) TO authenticated;

-- 3) Delivery-specific feedback table.
CREATE TABLE IF NOT EXISTS public.delivery_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delivery_feedback_order_buyer_unique UNIQUE (order_id, buyer_id)
);

ALTER TABLE public.delivery_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can insert delivery feedback for own completed orders"
ON public.delivery_feedback
FOR INSERT
TO authenticated
WITH CHECK (
  buyer_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = delivery_feedback.order_id
      AND o.buyer_id = auth.uid()
      AND o.seller_id = delivery_feedback.seller_id
      AND o.status IN ('delivered', 'completed')
  )
);

CREATE POLICY "Buyers sellers and admins can view delivery feedback"
ON public.delivery_feedback
FOR SELECT
TO public
USING (
  buyer_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = delivery_feedback.seller_id
      AND sp.user_id = auth.uid()
  )
  OR is_admin(auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_delivery_feedback_order_id ON public.delivery_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_feedback_seller_id ON public.delivery_feedback(seller_id);

-- 4) Ensure only one stalled-delivery cron job exists, then schedule monitor.
DO $$
DECLARE
  _job_id bigint;
BEGIN
  FOR _job_id IN
    SELECT jobid
    FROM cron.job
    WHERE command ILIKE '%monitor-stalled-deliveries%'
  LOOP
    PERFORM cron.unschedule(_job_id);
  END LOOP;
END $$;

SELECT cron.schedule(
  'monitor_stalled_deliveries_every_5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ywhlqsgvbkvcvqlsniad.supabase.co/functions/v1/monitor-stalled-deliveries',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aGxxc2d2Ymt2Y3ZxbHNuaWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTY1NDEsImV4cCI6MjA4ODM3MjU0MX0.uBtwDdGBgdb3KRYPptfBV1plydCnnRq1KNLH5xVlkjI"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);