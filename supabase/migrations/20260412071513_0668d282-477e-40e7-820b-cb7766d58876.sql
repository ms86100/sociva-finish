
-- 1. Support Tickets table
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid REFERENCES public.societies(id),
  issue_type text NOT NULL,
  issue_subtype text,
  description text DEFAULT '',
  evidence_urls text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'open',
  resolution_type text,
  resolution_note text,
  sla_deadline timestamptz,
  sla_breached boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_support_tickets_idempotent
ON public.support_tickets (order_id, issue_type)
WHERE status IN ('open', 'seller_pending');

CREATE INDEX idx_support_tickets_buyer ON public.support_tickets(buyer_id);
CREATE INDEX idx_support_tickets_seller ON public.support_tickets(seller_id);
CREATE INDEX idx_support_tickets_order ON public.support_tickets(order_id);
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX idx_support_tickets_sla ON public.support_tickets(sla_deadline) WHERE sla_breached = false AND status IN ('open', 'seller_pending');

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view own tickets"
ON public.support_tickets FOR SELECT TO authenticated
USING (auth.uid() = buyer_id);

CREATE POLICY "Sellers can view tickets for their orders"
ON public.support_tickets FOR SELECT TO authenticated
USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can create tickets"
ON public.support_tickets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Sellers can update ticket status"
ON public.support_tickets FOR UPDATE TO authenticated
USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can update own tickets"
ON public.support_tickets FOR UPDATE TO authenticated
USING (auth.uid() = buyer_id);

CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- 2. Support Ticket Messages table
CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL DEFAULT 'buyer',
  message_text text NOT NULL,
  action_type text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_messages_ticket ON public.support_ticket_messages(ticket_id);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ticket participants can view messages"
ON public.support_ticket_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_id
    AND (t.buyer_id = auth.uid() OR t.seller_id = auth.uid())
  )
);

CREATE POLICY "Ticket participants can send messages"
ON public.support_ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_id
    AND (t.buyer_id = auth.uid() OR t.seller_id = auth.uid())
  )
);

-- 3. Auto Resolution Rules table
CREATE TABLE public.auto_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type text NOT NULL,
  condition_json jsonb NOT NULL DEFAULT '{}',
  action_json jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_resolution_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rules"
ON public.auto_resolution_rules FOR SELECT TO authenticated
USING (true);

INSERT INTO public.auto_resolution_rules (issue_type, condition_json, action_json, priority) VALUES
('cancel_request', '{"order_status_in": ["placed", "confirmed", "preparing"]}', '{"type": "cancel_and_refund", "note": "Order cancelled and refund initiated automatically."}', 10),
('late_delivery', '{"eta_breached_minutes": 15}', '{"type": "apology", "note": "We apologize for the delay. Your order is on its way and will arrive shortly."}', 10),
('payment_issue', '{"payment_status": "failed"}', '{"type": "refund", "note": "Payment issue detected. A refund has been initiated."}', 10);

-- 4. fn_evaluate_support_resolution
CREATE OR REPLACE FUNCTION public.fn_evaluate_support_resolution(
  p_order_id uuid,
  p_issue_type text,
  p_issue_subtype text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_rule record;
  v_resolved boolean := false;
  v_resolution_type text;
  v_resolution_note text;
  v_conditions jsonb;
BEGIN
  SELECT id, status, payment_status, estimated_delivery_at, seller_id, buyer_id, society_id, total_amount
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('resolved', false, 'error', 'Order not found');
  END IF;

  FOR v_rule IN
    SELECT * FROM public.auto_resolution_rules
    WHERE issue_type = p_issue_type AND is_active = true
    ORDER BY priority DESC
  LOOP
    v_conditions := v_rule.condition_json;
    v_resolved := true;

    IF v_conditions ? 'order_status_in' THEN
      IF NOT (v_order.status = ANY(
        SELECT jsonb_array_elements_text(v_conditions->'order_status_in')
      )) THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved AND v_conditions ? 'eta_breached_minutes' THEN
      IF v_order.estimated_delivery_at IS NULL
         OR v_order.estimated_delivery_at > (now() - ((v_conditions->>'eta_breached_minutes')::int * interval '1 minute')) THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved AND v_conditions ? 'payment_status' THEN
      IF v_order.payment_status IS DISTINCT FROM (v_conditions->>'payment_status') THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved THEN
      v_resolution_type := v_rule.action_json->>'type';
      v_resolution_note := v_rule.action_json->>'note';
      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'resolved', v_resolved,
    'resolution_type', v_resolution_type,
    'resolution_note', v_resolution_note,
    'order_status', v_order.status,
    'seller_id', v_order.seller_id,
    'buyer_id', v_order.buyer_id,
    'society_id', v_order.society_id
  );
END;
$$;

-- 5. fn_check_support_sla
CREATE OR REPLACE FUNCTION public.fn_check_support_sla()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
BEGIN
  FOR v_ticket IN
    SELECT id, seller_id, order_id
    FROM public.support_tickets
    WHERE sla_breached = false
      AND status IN ('open', 'seller_pending')
      AND sla_deadline < now()
  LOOP
    UPDATE public.support_tickets
    SET sla_breached = true, updated_at = now()
    WHERE id = v_ticket.id;

    INSERT INTO public.notification_queue (user_id, title, body, action_type, action_id, priority)
    VALUES (
      v_ticket.seller_id,
      'Support ticket overdue',
      'A customer support ticket has exceeded its SLA deadline. Please respond urgently.',
      'support_ticket',
      v_ticket.id::text,
      'high'
    );
  END LOOP;
END;
$$;

-- 6. Storage bucket for evidence
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-evidence', 'support-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Buyers can upload evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'support-evidence'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Buyers can view own evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'support-evidence'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Sellers can view evidence for their tickets"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'support-evidence'
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.seller_id = auth.uid()
    AND t.evidence_urls @> ARRAY[name]
  )
);
