
-- ============================================================
-- P1: REFUND & DISPUTE RESOLUTION ENGINE
-- ============================================================

-- 1. Create refund_requests table
CREATE TABLE public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dispute_id uuid REFERENCES dispute_tickets(id) ON DELETE SET NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid,
  society_id uuid REFERENCES societies(id),
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  category text NOT NULL DEFAULT 'order_issue',
  refund_method text NOT NULL DEFAULT 'original_payment',
  status text NOT NULL DEFAULT 'requested',
  auto_approved boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  processed_at timestamptz,
  settled_at timestamptz,
  rejection_reason text,
  evidence_urls text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_refund_requests_order_id ON public.refund_requests (order_id);
CREATE INDEX idx_refund_requests_buyer_id ON public.refund_requests (buyer_id);
CREATE INDEX idx_refund_requests_status ON public.refund_requests (status);
CREATE INDEX idx_refund_requests_created_at ON public.refund_requests (created_at DESC);

-- RLS: Buyers see their own, sellers see their orders' refunds
CREATE POLICY "Buyers can view own refund requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id);

CREATE POLICY "Sellers can view refunds for their orders"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can create refund requests"
  ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Service role full access on refund_requests"
  ON public.refund_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER trg_update_updated_at_refund_requests
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Auto-refund on seller cancellation
CREATE OR REPLACE FUNCTION public.fn_auto_refund_on_seller_cancel()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Only trigger on status change to cancelled
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status::text != 'cancelled' THEN RETURN NEW; END IF;
  
  -- Only auto-refund if seller caused the cancellation
  IF COALESCE(NEW.failure_owner, '') NOT IN ('seller', 'platform') THEN RETURN NEW; END IF;
  
  -- Only if payment was already made
  IF NEW.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN RETURN NEW; END IF;
  
  -- Check if refund already exists for this order
  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = NEW.id) THEN RETURN NEW; END IF;
  
  -- Create auto-approved refund request
  INSERT INTO refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, status, auto_approved, approved_at)
  VALUES (
    NEW.id,
    NEW.buyer_id,
    NEW.seller_id,
    NEW.society_id,
    COALESCE(NEW.frozen_total, NEW.total_amount),
    'Order cancelled by seller',
    'seller_cancelled',
    'approved',
    true,
    now()
  );
  
  -- Update order payment_status to refund_initiated
  NEW.payment_status := 'refund_initiated';
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_auto_refund_on_seller_cancel
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_auto_refund_on_seller_cancel();

-- 3. Set SLA deadline on dispute creation
CREATE OR REPLACE FUNCTION public.fn_set_dispute_sla()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Set 48-hour SLA deadline if not already set
  IF NEW.sla_deadline IS NULL THEN
    NEW.sla_deadline := now() + interval '48 hours';
  END IF;
  
  -- Auto-set society_id from order if not provided
  IF NEW.society_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT society_id INTO NEW.society_id FROM orders WHERE id = NEW.order_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_set_dispute_sla
  BEFORE INSERT ON dispute_tickets
  FOR EACH ROW EXECUTE FUNCTION fn_set_dispute_sla();

-- 4. Dispute SLA breach auto-resolution (called by cron)
CREATE OR REPLACE FUNCTION public.fn_check_dispute_sla_breach()
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_dispute record;
BEGIN
  FOR v_dispute IN 
    SELECT dt.id, dt.order_id, dt.raised_by, dt.against_user
    FROM dispute_tickets dt
    WHERE dt.status = 'open'
      AND dt.sla_deadline IS NOT NULL
      AND dt.sla_deadline < now()
  LOOP
    -- Auto-resolve in buyer's favor
    UPDATE dispute_tickets
    SET status = 'resolved',
        resolution = 'auto_resolved_sla_breach',
        resolution_note = 'Automatically resolved in buyer''s favor due to 48-hour SLA breach. Seller did not respond within the required timeframe.',
        resolved_at = now(),
        updated_at = now()
    WHERE id = v_dispute.id;
    
    -- Create auto-approved refund if order has payment
    INSERT INTO refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, dispute_id, status, auto_approved, approved_at)
    SELECT 
      o.id,
      o.buyer_id,
      o.seller_id,
      o.society_id,
      COALESCE(o.frozen_total, o.total_amount),
      'Dispute auto-resolved: seller did not respond within 48 hours',
      'sla_breach',
      v_dispute.id,
      'approved',
      true,
      now()
    FROM orders o
    WHERE o.id = v_dispute.order_id
      AND o.payment_status IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed')
      AND NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.order_id = o.id AND rr.status NOT IN ('rejected'));
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$function$;

-- 5. Create a buyer-facing RPC to request a refund (validates ownership + idempotency)
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue',
  p_evidence_urls text[] DEFAULT NULL
)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
BEGIN
  -- Validate order belongs to caller
  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();
  
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;
  
  -- Check payment was made
  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;
  
  -- Check no existing active refund
  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;
  
  INSERT INTO refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, evidence_urls)
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(v_order.frozen_total, v_order.total_amount),
    p_reason,
    p_category,
    p_evidence_urls
  )
  RETURNING id INTO v_refund_id;
  
  -- Auto-create dispute ticket if not already exists
  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;
  
  RETURN v_refund_id;
END;
$function$;
