-- External provider/bank evidence and exception operations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('razorpay', 'bank')),
  statement_date date NOT NULL,
  source_filename text,
  source_checksum text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'completed', 'failed', 'dead_letter')
  ),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_by uuid,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(source, source_checksum)
);

CREATE TABLE IF NOT EXISTS public.provider_statement_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES public.financial_statement_imports(id),
  provider text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('payment', 'refund', 'transfer', 'settlement')
  ),
  external_reference text NOT NULL,
  parent_reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  currency text NOT NULL CHECK (currency = upper(currency)),
  provider_status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  settled_at timestamptz,
  raw_payload jsonb NOT NULL,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_type, external_reference)
);

CREATE TABLE IF NOT EXISTS public.bank_statement_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.financial_statement_imports(id),
  account_reference text NOT NULL,
  transaction_reference text NOT NULL,
  provider_settlement_reference text,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = upper(currency)),
  value_date date NOT NULL,
  narration text,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_reference, transaction_reference)
);

CREATE TABLE IF NOT EXISTS public.provider_statement_row_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_statement_row_id uuid NOT NULL
    REFERENCES public.provider_statement_rows(id),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  previous_payload jsonb NOT NULL,
  new_payload jsonb NOT NULL,
  previous_fingerprint text NOT NULL,
  new_fingerprint text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_statement_row_id uuid REFERENCES public.provider_statement_rows(id),
  bank_statement_row_id uuid REFERENCES public.bank_statement_rows(id),
  internal_reference_type text NOT NULL,
  internal_reference_id text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('exact', 'approved_manual')),
  amount_difference_minor bigint NOT NULL,
  matched_by uuid,
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_statement_row_id),
  UNIQUE(bank_statement_row_id)
);

CREATE TABLE IF NOT EXISTS public.financial_exception_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_record_id uuid REFERENCES public.financial_reconciliation_records(id),
  exception_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  owner_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'acknowledged', 'investigating', 'resolved', 'dead_letter')
  ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  escalation_due_at timestamptz NOT NULL DEFAULT (now() + interval '4 hours'),
  escalated_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at timestamptz,
  last_error text,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(reconciliation_record_id)
);

CREATE TABLE IF NOT EXISTS public.opening_balance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  evidence jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 20),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'posted')
  ),
  requested_by uuid NOT NULL,
  approved_by uuid,
  journal_transaction_id uuid REFERENCES finance.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

ALTER TABLE public.financial_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_statement_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_statement_row_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_exception_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_balance_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_statement_imports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_statement_rows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bank_statement_rows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_statement_row_revisions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reconciliation_matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_exception_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.opening_balance_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_statement_imports TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.provider_statement_rows TO service_role;
GRANT SELECT, INSERT ON public.bank_statement_rows TO service_role;
GRANT SELECT, INSERT ON public.provider_statement_row_revisions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_matches TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.financial_exception_queue TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.opening_balance_requests TO service_role;

CREATE POLICY "Admins view reconciliation exceptions"
  ON public.financial_exception_queue FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins view opening balance requests"
  ON public.opening_balance_requests FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.financial_exception_queue TO authenticated;
GRANT SELECT ON public.opening_balance_requests TO authenticated;

CREATE OR REPLACE FUNCTION finance.guard_provider_statement_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.parent_reference IS DISTINCT FROM OLD.parent_reference
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'provider statement financial identity is immutable';
  END IF;
  IF NEW.payload_fingerprint IS DISTINCT FROM OLD.payload_fingerprint THEN
    INSERT INTO public.provider_statement_row_revisions (
      provider_statement_row_id, previous_status, new_status,
      previous_payload, new_payload, previous_fingerprint, new_fingerprint
    ) VALUES (
      OLD.id, OLD.provider_status, NEW.provider_status,
      OLD.raw_payload, NEW.raw_payload,
      OLD.payload_fingerprint, NEW.payload_fingerprint
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_statement_revision
  ON public.provider_statement_rows;
CREATE TRIGGER trg_guard_provider_statement_revision
BEFORE UPDATE ON public.provider_statement_rows
FOR EACH ROW EXECUTE FUNCTION finance.guard_provider_statement_revision();

CREATE OR REPLACE FUNCTION finance.queue_reconciliation_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('open', 'investigating') THEN
    INSERT INTO public.financial_exception_queue (
      reconciliation_record_id, exception_type, severity, metadata
    ) VALUES (
      NEW.id,
      NEW.reference_type,
      CASE WHEN abs(COALESCE(NEW.difference_minor, 0)) >= 100000
        THEN 'critical' ELSE 'warning' END,
      jsonb_build_object(
        'provider', NEW.provider,
        'reference_id', NEW.reference_id,
        'difference_minor', NEW.difference_minor,
        'reason', NEW.reason
      )
    )
    ON CONFLICT (reconciliation_record_id) DO UPDATE
    SET status = CASE
          WHEN public.financial_exception_queue.status = 'resolved'
          THEN 'open'
          ELSE public.financial_exception_queue.status
        END,
        severity = EXCLUDED.severity,
        metadata = EXCLUDED.metadata,
        escalation_due_at = CASE
          WHEN public.financial_exception_queue.status = 'resolved'
          THEN now() + interval '4 hours'
          ELSE public.financial_exception_queue.escalation_due_at
        END;
  ELSIF NEW.status IN ('matched', 'resolved') THEN
    UPDATE public.financial_exception_queue
    SET status = 'resolved',
        resolution = 'Underlying reconciliation record matched',
        resolved_at = now()
    WHERE reconciliation_record_id = NEW.id
      AND status <> 'resolved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_reconciliation_exception
  ON public.financial_reconciliation_records;
CREATE TRIGGER trg_queue_reconciliation_exception
AFTER INSERT OR UPDATE OF status, difference_minor
ON public.financial_reconciliation_records
FOR EACH ROW EXECUTE FUNCTION finance.queue_reconciliation_exception();

CREATE OR REPLACE FUNCTION finance.reconcile_external_statements(
  p_reconciliation_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_provider_mismatches integer;
  v_bank_mismatches integer;
  v_unmatched_internal integer;
BEGIN
  INSERT INTO public.financial_reconciliation_records (
    provider, reconciliation_date, reference_type, reference_id,
    internal_amount_minor, provider_amount_minor, status, reason,
    metadata, updated_at
  )
  SELECT
    ps.provider,
    p_reconciliation_date,
    'provider_' || ps.event_type,
    ps.external_reference,
    CASE ps.event_type
      WHEN 'payment' THEN pc.amount_minor
      WHEN 'refund' THEN ra.amount_minor
      WHEN 'transfer' THEN pa.amount_minor
      ELSE NULL
    END,
    ps.amount_minor,
    CASE
      WHEN ps.currency <> 'INR' THEN 'open'
      WHEN ps.event_type = 'payment'
        AND pc.id IS NOT NULL
        AND pc.amount_minor = ps.amount_minor
        AND pc.status = 'captured'
        AND lower(ps.provider_status) = 'captured' THEN 'matched'
      WHEN ps.event_type = 'refund'
        AND ra.id IS NOT NULL
        AND ra.amount_minor = ps.amount_minor
        AND ra.status = 'succeeded'
        AND lower(ps.provider_status) = 'processed' THEN 'matched'
      WHEN ps.event_type = 'transfer'
        AND pa.id IS NOT NULL
        AND pa.amount_minor = ps.amount_minor
        AND pa.status = 'succeeded'
        AND lower(ps.provider_status) = 'processed' THEN 'matched'
      WHEN ps.event_type = 'settlement' THEN 'open'
      ELSE 'open'
    END,
    CASE
      WHEN ps.currency <> 'INR' THEN 'Provider statement currency mismatch'
      WHEN ps.event_type = 'settlement'
        THEN 'Bank statement evidence required for provider settlement'
      WHEN (
        (ps.event_type = 'payment' AND lower(ps.provider_status) <> 'captured')
        OR (ps.event_type IN ('refund', 'transfer')
          AND lower(ps.provider_status) <> 'processed')
      ) THEN 'Provider row is not in a terminal recognized state'
      WHEN COALESCE(pc.id, ra.id, pa.id) IS NULL
        THEN 'Provider row has no exact internal reference'
      WHEN COALESCE(pc.amount_minor, ra.amount_minor, pa.amount_minor)
        <> ps.amount_minor THEN 'Provider and internal amounts differ'
      ELSE NULL
    END,
    jsonb_build_object(
      'provider_statement_row_id', ps.id,
      'provider_status', ps.provider_status,
      'parent_reference', ps.parent_reference,
      'payload_fingerprint', ps.payload_fingerprint
    ),
    now()
  FROM public.provider_statement_rows ps
  LEFT JOIN public.payment_captures pc
    ON ps.event_type = 'payment'
   AND pc.provider = ps.provider
   AND pc.provider_payment_id = ps.external_reference
  LEFT JOIN public.refund_attempts ra
    ON ps.event_type = 'refund'
   AND ra.provider = ps.provider
   AND ra.provider_refund_id = ps.external_reference
  LEFT JOIN public.payout_attempts pa
    ON ps.event_type = 'transfer'
   AND pa.provider_transfer_id = ps.external_reference
  WHERE ps.occurred_at::date = p_reconciliation_date
  ON CONFLICT (provider, reconciliation_date, reference_type, reference_id)
  DO UPDATE SET
    internal_amount_minor = EXCLUDED.internal_amount_minor,
    provider_amount_minor = EXCLUDED.provider_amount_minor,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    metadata = EXCLUDED.metadata,
    updated_at = now();

  -- A provider settlement is matched only by exact bank reference, amount and
  -- direction; date/amount-only matching is intentionally forbidden.
  INSERT INTO public.reconciliation_matches (
    provider_statement_row_id, bank_statement_row_id,
    internal_reference_type, internal_reference_id,
    match_type, amount_difference_minor
  )
  SELECT
    ps.id, bs.id, 'provider_settlement', ps.external_reference,
    'exact', bs.amount_minor - ps.amount_minor
  FROM public.provider_statement_rows ps
  JOIN public.bank_statement_rows bs
    ON bs.provider_settlement_reference = ps.external_reference
   AND bs.amount_minor = ps.amount_minor
   AND bs.currency = ps.currency
   AND bs.direction = 'credit'
  WHERE ps.event_type = 'settlement'
    AND ps.occurred_at::date = p_reconciliation_date
  ON CONFLICT (provider_statement_row_id) DO NOTHING;

  UPDATE public.financial_reconciliation_records r
  SET status = 'matched',
      internal_amount_minor = r.provider_amount_minor,
      reason = NULL,
      updated_at = now()
  FROM public.provider_statement_rows ps
  JOIN public.reconciliation_matches m
    ON m.provider_statement_row_id = ps.id
   AND m.match_type = 'exact'
   AND m.amount_difference_minor = 0
  WHERE r.provider = ps.provider
    AND r.reconciliation_date = p_reconciliation_date
    AND r.reference_type = 'provider_settlement'
    AND r.reference_id = ps.external_reference;

  SELECT count(*) INTO v_provider_mismatches
  FROM public.financial_reconciliation_records
  WHERE reconciliation_date = p_reconciliation_date
    AND reference_type LIKE 'provider_%'
    AND status IN ('open', 'investigating');

  SELECT count(*) INTO v_bank_mismatches
  FROM public.bank_statement_rows bs
  LEFT JOIN public.reconciliation_matches m
    ON m.bank_statement_row_id = bs.id
  WHERE bs.value_date = p_reconciliation_date
    AND m.id IS NULL;

  SELECT count(*) INTO v_unmatched_internal
  FROM public.payment_captures pc
  LEFT JOIN public.provider_statement_rows ps
    ON ps.provider = pc.provider
   AND ps.event_type = 'payment'
   AND ps.external_reference = pc.provider_payment_id
  WHERE pc.captured_at::date = p_reconciliation_date
    AND ps.id IS NULL;

  RETURN jsonb_build_object(
    'reconciliation_date', p_reconciliation_date,
    'provider_mismatches', v_provider_mismatches,
    'bank_mismatches', v_bank_mismatches,
    'unmatched_internal_captures', v_unmatched_internal,
    'clean', v_provider_mismatches = 0
      AND v_bank_mismatches = 0
      AND v_unmatched_internal = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_external_statements(
  p_reconciliation_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.reconcile_external_statements(p_reconciliation_date);
$$;
REVOKE ALL ON FUNCTION public.reconcile_external_statements(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_external_statements(date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.request_opening_balance(
  p_account_code text,
  p_amount_minor bigint,
  p_evidence jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM finance.ledger_accounts WHERE code = p_account_code AND active
  ) THEN
    RAISE EXCEPTION 'unknown ledger account';
  END IF;
  INSERT INTO public.opening_balance_requests (
    account_code, amount_minor, evidence, reason, requested_by
  ) VALUES (
    p_account_code, p_amount_minor, p_evidence, p_reason, auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_opening_balance(
  text, bigint, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_opening_balance(
  text, bigint, jsonb, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_financial_backfill_candidate(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_candidate public.financial_backfill_candidates%ROWTYPE;
  v_provider public.provider_statement_rows%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO v_candidate
  FROM public.financial_backfill_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND OR v_candidate.review_status <> 'pending' THEN
    RAISE EXCEPTION 'pending backfill candidate not found';
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_statement_rows
  WHERE provider = 'razorpay'
    AND event_type = 'payment'
    AND external_reference = v_candidate.source_reference
    AND amount_minor = v_candidate.proposed_amount_minor
    AND currency = v_candidate.currency
    AND lower(provider_status) = 'captured';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exact captured provider evidence is required';
  END IF;

  UPDATE public.financial_backfill_candidates
  SET confidence = 'high',
      review_status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      evidence = evidence || jsonb_build_object(
        'provider_statement_row_id', v_provider.id,
        'provider_payload_fingerprint', v_provider.payload_fingerprint
      ),
      updated_at = now()
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'approved', true,
    'candidate_id', p_candidate_id,
    'provider_statement_row_id', v_provider.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_opening_balance(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.opening_balance_requests%ROWTYPE;
  v_transaction_id uuid;
  v_amount bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO v_request
  FROM public.opening_balance_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending opening balance request not found';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'maker cannot approve own opening balance';
  END IF;
  IF v_request.amount_minor = 0 THEN
    RAISE EXCEPTION 'zero opening balance is not postable';
  END IF;
  v_amount := abs(v_request.amount_minor);
  v_transaction_id := finance.post_journal(
    'ADJUSTMENT', 'opening_balance', v_request.id::text,
    'opening-balance:' || v_request.id::text,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', v_request.account_code,
        'direction', CASE WHEN v_request.amount_minor > 0
          THEN 'debit' ELSE 'credit' END,
        'amount_minor', v_amount
      ),
      jsonb_build_object(
        'account_code', 'financial_suspense',
        'direction', CASE WHEN v_request.amount_minor > 0
          THEN 'credit' ELSE 'debit' END,
        'amount_minor', v_amount
      )
    ),
    v_request.reason,
    v_request.evidence || jsonb_build_object(
      'maker', v_request.requested_by,
      'checker', auth.uid()
    ),
    now(), NULL
  );
  UPDATE public.opening_balance_requests
  SET status = 'posted',
      approved_by = auth.uid(),
      journal_transaction_id = v_transaction_id,
      decided_at = now()
  WHERE id = p_request_id;
  RETURN jsonb_build_object(
    'posted', true,
    'request_id', p_request_id,
    'journal_transaction_id', v_transaction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_opening_balance(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_opening_balance(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION finance.apply_verified_backfill_candidate(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_candidate public.financial_backfill_candidates%ROWTYPE;
  v_provider public.provider_statement_rows%ROWTYPE;
  v_order_ids uuid[];
  v_result jsonb;
BEGIN
  SELECT * INTO v_candidate
  FROM public.financial_backfill_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_candidate.review_status <> 'approved'
     OR v_candidate.confidence <> 'high' THEN
    RAISE EXCEPTION 'approved high-confidence candidate required';
  END IF;
  IF v_candidate.applied_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'applied', true, 'deduplicated', true,
      'transaction_id', v_candidate.applied_transaction_id
    );
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_statement_rows
  WHERE id = NULLIF(
    v_candidate.evidence->>'provider_statement_row_id', ''
  )::uuid
    AND external_reference = v_candidate.source_reference
    AND amount_minor = v_candidate.proposed_amount_minor
    AND lower(provider_status) = 'captured'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approved provider evidence no longer matches candidate';
  END IF;

  SELECT array_agg(value::text::uuid ORDER BY value::text::uuid)
  INTO v_order_ids
  FROM jsonb_array_elements_text(v_candidate.evidence->'order_ids') value;
  IF cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'backfill candidate has no evidenced orders';
  END IF;

  v_result := finance.confirm_captured_payment_group(
    v_order_ids,
    v_provider.external_reference,
    v_provider.parent_reference,
    v_provider.amount_minor,
    v_provider.currency,
    v_provider.occurred_at,
    'evidence_backfill'
  );

  UPDATE public.financial_backfill_candidates
  SET review_status = 'applied',
      applied_transaction_id = (
        SELECT id
        FROM finance.ledger_transactions
        WHERE idempotency_key =
          'capture:razorpay:' || v_provider.external_reference
      ),
      updated_at = now()
  WHERE id = p_candidate_id
  RETURNING applied_transaction_id
  INTO v_candidate.applied_transaction_id;

  IF v_candidate.applied_transaction_id IS NULL THEN
    RAISE EXCEPTION 'backfill confirmation produced no canonical capture journal';
  END IF;
  RETURN v_result || jsonb_build_object(
    'applied', true,
    'transaction_id', v_candidate.applied_transaction_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_verified_backfill_candidate(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.apply_verified_backfill_candidate(p_candidate_id);
$$;

REVOKE ALL ON FUNCTION public.approve_financial_backfill_candidate(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_financial_backfill_candidate(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.apply_verified_backfill_candidate(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_backfill_candidate(uuid)
  TO service_role;

COMMIT;
