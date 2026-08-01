
-- ============================================================
-- ENTERPRISE REFUND SYSTEM
-- Tables, state machine, RPCs, audit log, ledger
-- ============================================================

-- 1. payment_ledger -- immutable financial record
CREATE TABLE IF NOT EXISTS public.payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  refund_id uuid,
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('debit','credit','refund')),
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  reference_id text,
  idempotency_key text NOT NULL UNIQUE,
  gateway text NOT NULL DEFAULT 'manual',
  gateway_response jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_ledger_order ON public.payment_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_ledger_refund ON public.payment_ledger(refund_id);
CREATE INDEX IF NOT EXISTS idx_payment_ledger_user ON public.payment_ledger(user_id);

ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_select_party" ON public.payment_ledger;
CREATE POLICY "ledger_select_party" ON public.payment_ledger FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payment_ledger.order_id
             AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid()))
);
-- No INSERT/UPDATE/DELETE policies — RPC SECURITY DEFINER only.

-- 2. Extend refund_requests with state-machine column
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS refund_state text,
  ADD COLUMN IF NOT EXISTS gateway_refund_id text,
  ADD COLUMN IF NOT EXISTS gateway_status text,
  ADD COLUMN IF NOT EXISTS sla_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- Backfill refund_state from legacy status
UPDATE public.refund_requests
SET refund_state = CASE
  WHEN status = 'requested' THEN 'requested'
  WHEN status = 'rejected' THEN 'rejected'
  WHEN status = 'settled' OR status = 'completed' THEN 'refund_completed'
  WHEN status = 'processing' THEN 'refund_processing'
  WHEN status = 'approved' THEN 'approved'
  ELSE COALESCE(refund_state, status)
END
WHERE refund_state IS NULL;

ALTER TABLE public.refund_requests
  ALTER COLUMN refund_state SET DEFAULT 'requested',
  ALTER COLUMN refund_state SET NOT NULL;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_state_check;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_state_check CHECK (refund_state IN (
    'requested','approved','rejected',
    'refund_initiated','refund_processing',
    'refund_completed','refund_failed'
  ));

-- 3. refund_audit_log (append-only)
CREATE TABLE IF NOT EXISTS public.refund_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refund_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  actor_role text NOT NULL DEFAULT 'system',
  before_state text,
  after_state text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refund_audit_refund ON public.refund_audit_log(refund_id, created_at);

ALTER TABLE public.refund_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "refund_audit_select_party" ON public.refund_audit_log;
CREATE POLICY "refund_audit_select_party" ON public.refund_audit_log FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.refund_requests r
    JOIN public.orders o ON o.id = r.order_id
    WHERE r.id = refund_audit_log.refund_id
      AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE — RPC only.

-- 4. State-machine enforcement trigger
CREATE OR REPLACE FUNCTION public.enforce_refund_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF NEW.refund_state IS NOT DISTINCT FROM OLD.refund_state THEN
    RETURN NEW;
  END IF;

  -- Allowed transitions
  ok := (OLD.refund_state, NEW.refund_state) IN (
    ('requested','approved'),
    ('requested','rejected'),
    ('approved','refund_initiated'),
    ('refund_initiated','refund_processing'),
    ('refund_initiated','refund_completed'),
    ('refund_processing','refund_completed'),
    ('refund_processing','refund_failed'),
    ('refund_failed','refund_initiated')
  );

  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid refund_state transition: % -> %', OLD.refund_state, NEW.refund_state
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_state_machine ON public.refund_requests;
CREATE TRIGGER trg_refund_state_machine
BEFORE UPDATE OF refund_state ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_state_machine();

-- ============================================================
-- 5. RPCs
-- ============================================================

-- approve_refund
CREATE OR REPLACE FUNCTION public.approve_refund(p_refund_id uuid)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_seller uuid;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  SELECT seller_id INTO v_seller FROM public.orders WHERE id = r.order_id;
  IF v_seller IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the seller can approve this refund' USING ERRCODE = '42501';
  END IF;

  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be approved from state: %', r.refund_state;
  END IF;

  UPDATE public.refund_requests
  SET refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state)
  VALUES (p_refund_id, 'approve', auth.uid(), 'seller', 'requested', 'approved');

  RETURN r;
END;
$$;

-- reject_refund
CREATE OR REPLACE FUNCTION public.reject_refund(p_refund_id uuid, p_reason text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_seller uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  SELECT seller_id INTO v_seller FROM public.orders WHERE id = r.order_id;
  IF v_seller IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the seller can reject this refund' USING ERRCODE = '42501';
  END IF;

  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be rejected from state: %', r.refund_state;
  END IF;

  UPDATE public.refund_requests
  SET refund_state = 'rejected',
      status = 'rejected',
      rejection_reason = trim(p_reason),
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'reject', auth.uid(), 'seller', 'requested', 'rejected',
          jsonb_build_object('reason', trim(p_reason)));

  RETURN r;
END;
$$;

-- initiate_refund (idempotent via ledger UNIQUE key)
CREATE OR REPLACE FUNCTION public.initiate_refund(p_refund_id uuid, p_idempotency_key text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_existing_ledger uuid;
BEGIN
  -- Idempotency short-circuit
  SELECT id INTO v_existing_ledger FROM public.payment_ledger WHERE idempotency_key = p_idempotency_key;
  IF v_existing_ledger IS NOT NULL THEN
    SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
    RETURN r;
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF r.refund_state <> 'approved' THEN
    RAISE EXCEPTION 'Refund cannot be initiated from state: %', r.refund_state;
  END IF;

  -- Insert ledger entry (UNIQUE constraint enforces idempotency at DB level)
  INSERT INTO public.payment_ledger(order_id, refund_id, user_id, type, amount, status, idempotency_key, gateway)
  VALUES (r.order_id, r.id, r.buyer_id, 'refund', r.amount, 'pending', p_idempotency_key, 'manual');

  UPDATE public.refund_requests
  SET refund_state = 'refund_initiated',
      status = 'processing',
      processed_at = now(),
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'initiate', 'system', 'approved', 'refund_initiated',
          jsonb_build_object('idempotency_key', p_idempotency_key));

  RETURN r;
END;
$$;

-- complete_refund
CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid, p_gateway_ref text, p_gateway_status text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_before text;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object('gateway_ref', p_gateway_ref, 'gateway_status', p_gateway_status));

  -- Notify buyer
  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          'Your refund of ₹' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object('orderId', r.order_id, 'refundId', r.id, 'status', 'refund_completed', 'target_role', 'buyer'));

  RETURN r;
END;
$$;

-- fail_refund
CREATE OR REPLACE FUNCTION public.fail_refund(p_refund_id uuid, p_reason text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_before text;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be failed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger SET status = 'failed', updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_failed',
      failure_reason = p_reason,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'fail', 'system', v_before, 'refund_failed',
          jsonb_build_object('reason', p_reason));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund failed',
          'Your refund could not be processed automatically. Our team will contact you shortly.',
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object('orderId', r.order_id, 'refundId', r.id, 'status', 'refund_failed', 'target_role', 'buyer'));

  RETURN r;
END;
$$;

-- Realtime
ALTER TABLE public.refund_requests REPLICA IDENTITY FULL;
ALTER TABLE public.refund_audit_log REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='refund_requests';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.refund_requests';
  END IF;
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='refund_audit_log';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.refund_audit_log';
  END IF;
END $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.approve_refund(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_refund(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_refund(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_refund(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_refund(uuid, text) TO service_role;
