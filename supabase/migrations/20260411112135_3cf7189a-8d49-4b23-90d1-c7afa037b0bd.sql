
-- 1. Reset all stuck processing notifications to pending
UPDATE notification_queue SET status = 'pending', updated_at = now() WHERE status = 'processing';

-- 2. Create disputes table
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  society_id UUID REFERENCES public.societies(id),
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','resolved_buyer','resolved_seller','escalated','closed')),
  resolution_notes TEXT,
  seller_response TEXT,
  seller_responded_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_order_id ON public.disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_buyer_id ON public.disputes(buyer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_seller_id ON public.disputes(seller_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view their own disputes" ON public.disputes
  FOR SELECT USING (auth.uid() = buyer_id);

CREATE POLICY "Sellers can view disputes against them" ON public.disputes
  FOR SELECT USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can create disputes" ON public.disputes
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Sellers can update disputes against them" ON public.disputes
  FOR UPDATE USING (auth.uid() = seller_id);

CREATE POLICY "Admins can view all disputes" ON public.disputes
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all disputes" ON public.disputes
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_disputes_updated_at
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. Fix claim_notification_queue to auto-recover stuck items
CREATE OR REPLACE FUNCTION public.claim_notification_queue(_batch_size integer DEFAULT 50)
RETURNS SETOF notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notification_queue
  SET status = 'pending', updated_at = now()
  WHERE status = 'processing'
    AND updated_at < (now() - interval '3 minutes');

  RETURN QUERY
  UPDATE notification_queue SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT nq.id FROM notification_queue nq
    WHERE nq.status = 'pending'
      AND (nq.next_retry_at IS NULL OR nq.next_retry_at <= now())
    ORDER BY nq.created_at ASC
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
