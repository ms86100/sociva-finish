-- Independent, default-off controls for external statement ingestion,
-- read-only projections, matching, shadow evidence, and exception operations.
-- This migration does not enable a capability or schedule a worker.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

INSERT INTO public.financial_feature_flags (key, enabled, description)
VALUES
  ('reconciliation_projection_enabled', false,
   'Allow database-only, read-only reconciliation projections'),
  ('provider_statement_ingest_enabled', false,
   'Allow supplied provider statements to be staged; never calls providers'),
  ('bank_statement_ingest_enabled', false,
   'Allow supplied bank statements to be staged'),
  ('reconciliation_matching_enabled', false,
   'Allow staged evidence to write matches and exceptions'),
  ('reconciliation_replay_enabled', false,
   'Allow an operator to request dead-letter replay')
ON CONFLICT (key) DO UPDATE
SET enabled = false,
    description = EXCLUDED.description,
    updated_at = now(),
    updated_by = NULL;

ALTER TABLE public.financial_statement_imports
  ADD COLUMN IF NOT EXISTS parent_import_id uuid
    REFERENCES public.financial_statement_imports(id),
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS account_reference_masked text,
  ADD COLUMN IF NOT EXISTS opening_balance_minor bigint,
  ADD COLUMN IF NOT EXISTS closing_balance_minor bigint,
  ADD COLUMN IF NOT EXISTS total_debits_minor bigint,
  ADD COLUMN IF NOT EXISTS total_credits_minor bigint,
  ADD COLUMN IF NOT EXISTS accepted_row_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_row_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS finalized_by uuid;

ALTER TABLE public.provider_statement_rows
  ADD COLUMN IF NOT EXISTS source_line_number integer;

ALTER TABLE public.bank_statement_rows
  ADD COLUMN IF NOT EXISTS source_line_number integer,
  ADD COLUMN IF NOT EXISTS row_fingerprint text;

ALTER TABLE public.provider_statement_row_revisions
  ADD COLUMN IF NOT EXISTS revision_reason text,
  ADD COLUMN IF NOT EXISTS revised_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_import_source_line
  ON public.provider_statement_rows(import_id, source_line_number)
  WHERE import_id IS NOT NULL AND source_line_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_import_source_line
  ON public.bank_statement_rows(import_id, source_line_number)
  WHERE source_line_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_row_fingerprint
  ON public.bank_statement_rows(import_id, row_fingerprint)
  WHERE row_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reconciliation_shadow_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start date NOT NULL,
  window_end date NOT NULL,
  bank_grace_business_days integer NOT NULL DEFAULT 2
    CHECK (bank_grace_business_days BETWEEN 0 AND 10),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'review', 'clean', 'failed', 'closed')),
  acceptance_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_by uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  close_evidence jsonb,
  CHECK (window_end >= window_start)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_window_id uuid REFERENCES public.reconciliation_shadow_windows(id),
  reconciliation_date date NOT NULL,
  run_kind text NOT NULL CHECK (run_kind IN ('projection', 'matching')),
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed', 'dead_letter')),
  provider_import_ids uuid[] NOT NULL DEFAULT '{}',
  bank_import_ids uuid[] NOT NULL DEFAULT '{}',
  input_manifest_hash text,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.reconciliation_variance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.reconciliation_runs(id),
  reconciliation_record_id uuid
    REFERENCES public.financial_reconciliation_records(id),
  exception_id uuid REFERENCES public.financial_exception_queue(id),
  variance_key text NOT NULL,
  variance_type text NOT NULL,
  amount_difference_minor bigint,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  age_seconds bigint NOT NULL CHECK (age_seconds >= 0),
  age_bucket text NOT NULL
    CHECK (age_bucket IN ('lt_4h', '4h_24h', '1d_3d', '3d_7d', 'gte_7d')),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, variance_key)
);

CREATE TABLE IF NOT EXISTS public.financial_exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.financial_exception_queue(id),
  event_type text NOT NULL CHECK (
    event_type IN (
      'created', 'assigned', 'acknowledged', 'investigation_started',
      'escalated', 'retry_scheduled', 'resolved', 'dead_lettered',
      'replay_requested', 'replay_completed', 'replay_failed'
    )
  ),
  actor_id uuid,
  from_status text,
  to_status text,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_statement_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES public.financial_statement_imports(id),
  source text NOT NULL CHECK (source IN ('razorpay', 'bank')),
  source_line_number integer,
  payload_hash text NOT NULL,
  raw_payload jsonb NOT NULL,
  error_code text NOT NULL,
  error_message text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  status text NOT NULL DEFAULT 'dead_letter'
    CHECK (status IN ('dead_letter', 'replay_requested', 'replayed', 'abandoned')),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  replay_requested_by uuid,
  replay_requested_at timestamptz,
  terminal_reason text,
  UNIQUE(source, payload_hash, error_code)
);

CREATE TABLE IF NOT EXISTS public.financial_statement_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dead_letter_id uuid NOT NULL
    REFERENCES public.financial_statement_dead_letters(id),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  authorization_evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'completed', 'failed', 'cancelled')),
  result_import_id uuid REFERENCES public.financial_statement_imports(id),
  result_payload_hash text,
  completed_at timestamptz,
  error_message text
);

ALTER TABLE public.reconciliation_shadow_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_variance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_exception_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statement_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_statement_replays ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reconciliation_shadow_windows
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reconciliation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reconciliation_variance_snapshots
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_exception_events
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_statement_dead_letters
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_statement_replays
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_shadow_windows TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_runs TO service_role;
GRANT SELECT, INSERT ON public.reconciliation_variance_snapshots TO service_role;
GRANT SELECT, INSERT ON public.financial_exception_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.financial_statement_dead_letters TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.financial_statement_replays TO service_role;

CREATE OR REPLACE FUNCTION finance.reconciliation_gate(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = p_key
  ), false);
$$;

REVOKE ALL ON FUNCTION finance.reconciliation_gate(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.reconciliation_gate(text) TO service_role;

CREATE OR REPLACE FUNCTION finance.guard_statement_import()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'statement imports are immutable';
  END IF;
  IF OLD.status IN ('completed', 'dead_letter') THEN
    RAISE EXCEPTION 'finalized statement imports are immutable';
  END IF;
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.statement_date IS DISTINCT FROM OLD.statement_date
     OR NEW.source_checksum IS DISTINCT FROM OLD.source_checksum
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.account_reference_masked IS DISTINCT FROM OLD.account_reference_masked
     OR NEW.opening_balance_minor IS DISTINCT FROM OLD.opening_balance_minor THEN
    RAISE EXCEPTION 'statement import identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_statement_import
  ON public.financial_statement_imports;
CREATE TRIGGER trg_guard_statement_import
BEFORE UPDATE OR DELETE ON public.financial_statement_imports
FOR EACH ROW EXECUTE FUNCTION finance.guard_statement_import();

CREATE OR REPLACE FUNCTION finance.guard_statement_row_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_source text;
  v_status text;
BEGIN
  IF NEW.import_id IS NULL THEN
    RAISE EXCEPTION 'statement row import lineage is required';
  END IF;
  SELECT source, status INTO v_source, v_status
  FROM public.financial_statement_imports
  WHERE id = NEW.import_id;
  IF NOT FOUND OR v_status <> 'processing' THEN
    RAISE EXCEPTION 'open processing import is required';
  END IF;
  IF TG_TABLE_NAME = 'provider_statement_rows' AND v_source <> 'razorpay' THEN
    RAISE EXCEPTION 'provider row requires razorpay import';
  END IF;
  IF TG_TABLE_NAME = 'bank_statement_rows' AND v_source <> 'bank' THEN
    RAISE EXCEPTION 'bank row requires bank import';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_statement_insert
  ON public.provider_statement_rows;
CREATE TRIGGER trg_guard_provider_statement_insert
BEFORE INSERT ON public.provider_statement_rows
FOR EACH ROW EXECUTE FUNCTION finance.guard_statement_row_insert();
DROP TRIGGER IF EXISTS trg_guard_bank_statement_insert
  ON public.bank_statement_rows;
CREATE TRIGGER trg_guard_bank_statement_insert
BEFORE INSERT ON public.bank_statement_rows
FOR EACH ROW EXECUTE FUNCTION finance.guard_statement_row_insert();

CREATE OR REPLACE FUNCTION finance.guard_statement_row_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'statement evidence rows are immutable';
  END IF;
  IF current_setting('app.reconciliation_revision_authorized', true) <> 'on' THEN
    RAISE EXCEPTION 'statement evidence updates require revision workflow';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_statement_immutability
  ON public.provider_statement_rows;
CREATE TRIGGER trg_guard_provider_statement_immutability
BEFORE UPDATE OR DELETE ON public.provider_statement_rows
FOR EACH ROW EXECUTE FUNCTION finance.guard_statement_row_immutability();
DROP TRIGGER IF EXISTS trg_guard_bank_statement_immutability
  ON public.bank_statement_rows;
CREATE TRIGGER trg_guard_bank_statement_immutability
BEFORE UPDATE OR DELETE ON public.bank_statement_rows
FOR EACH ROW EXECUTE FUNCTION finance.guard_statement_row_immutability();

CREATE OR REPLACE FUNCTION public.get_reconciliation_projection(
  p_reconciliation_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT finance.reconciliation_gate('reconciliation_projection_enabled') THEN
    RAISE EXCEPTION 'reconciliation projection disabled';
  END IF;
  SELECT jsonb_build_object(
    'reconciliation_date', p_reconciliation_date,
    'provider_rows', (
      SELECT count(*) FROM public.provider_statement_rows
      WHERE occurred_at::date = p_reconciliation_date
    ),
    'bank_rows', (
      SELECT count(*) FROM public.bank_statement_rows
      WHERE value_date = p_reconciliation_date
    ),
    'matched_rows', (
      SELECT count(*)
      FROM public.reconciliation_matches m
      JOIN public.provider_statement_rows p
        ON p.id = m.provider_statement_row_id
      WHERE p.occurred_at::date = p_reconciliation_date
    ),
    'open_variances', (
      SELECT count(*)
      FROM public.financial_reconciliation_records
      WHERE reconciliation_date = p_reconciliation_date
        AND status IN ('open', 'investigating')
    ),
    'projected_at', statement_timestamp()
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reconciliation_projection(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reconciliation_projection(date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_financial_statement_import(
  p_source text,
  p_statement_date date,
  p_source_filename text,
  p_source_checksum text,
  p_parser_version text,
  p_manifest jsonb DEFAULT '{}'::jsonb,
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_account_reference_masked text DEFAULT NULL,
  p_opening_balance_minor bigint DEFAULT NULL,
  p_closing_balance_minor bigint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_gate text;
BEGIN
  IF p_source NOT IN ('razorpay', 'bank') THEN
    RAISE EXCEPTION 'unsupported statement source';
  END IF;
  v_gate := CASE p_source
    WHEN 'razorpay' THEN 'provider_statement_ingest_enabled'
    ELSE 'bank_statement_ingest_enabled'
  END;
  IF NOT finance.reconciliation_gate(v_gate) THEN
    RAISE EXCEPTION '% disabled', v_gate;
  END IF;
  IF p_source_checksum !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sha256 source checksum required';
  END IF;
  IF p_parser_version IS NULL OR length(btrim(p_parser_version)) < 1 THEN
    RAISE EXCEPTION 'parser version required';
  END IF;
  IF p_source = 'bank' AND (
    p_period_start IS NULL OR p_period_end IS NULL
    OR p_account_reference_masked IS NULL
    OR p_opening_balance_minor IS NULL OR p_closing_balance_minor IS NULL
  ) THEN
    RAISE EXCEPTION 'bank statement period, masked account, and balances required';
  END IF;
  INSERT INTO public.financial_statement_imports (
    source, statement_date, source_filename, source_checksum, imported_by,
    parser_version, manifest, period_start, period_end,
    account_reference_masked, opening_balance_minor, closing_balance_minor
  ) VALUES (
    p_source, p_statement_date, p_source_filename, p_source_checksum, auth.uid(),
    p_parser_version, COALESCE(p_manifest, '{}'::jsonb), p_period_start, p_period_end,
    p_account_reference_masked, p_opening_balance_minor, p_closing_balance_minor
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_provider_statement_rows(
  p_import_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_count integer := 0;
  v_rejected integer := 0;
  v_line integer := 0;
  v_payload_hash text;
BEGIN
  IF NOT finance.reconciliation_gate('provider_statement_ingest_enabled') THEN
    RAISE EXCEPTION 'provider statement ingestion disabled';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'provider rows must be an array';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_line := v_line + 1;
    v_payload_hash := encode(
      extensions.digest(convert_to(v_row::text, 'UTF8'), 'sha256'), 'hex'
    );
    BEGIN
      INSERT INTO public.provider_statement_rows (
        import_id, source_line_number, provider, event_type, external_reference,
        parent_reference, amount_minor, fee_minor, tax_minor, currency,
        provider_status, occurred_at, settled_at, raw_payload, payload_fingerprint
      ) VALUES (
        p_import_id, v_line, v_row->>'provider', v_row->>'event_type',
        v_row->>'external_reference', v_row->>'parent_reference',
        (v_row->>'amount_minor')::bigint,
        COALESCE((v_row->>'fee_minor')::bigint, 0),
        COALESCE((v_row->>'tax_minor')::bigint, 0),
        upper(v_row->>'currency'), v_row->>'provider_status',
        (v_row->>'occurred_at')::timestamptz,
        NULLIF(v_row->>'settled_at', '')::timestamptz,
        v_row, v_payload_hash
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected + 1;
      INSERT INTO public.financial_statement_dead_letters (
        import_id, source, source_line_number, payload_hash, raw_payload,
        error_code, error_message
      ) VALUES (
        p_import_id, 'razorpay', v_line, v_payload_hash, v_row, SQLSTATE, SQLERRM
      )
      ON CONFLICT (source, payload_hash, error_code) DO UPDATE
      SET attempt_count =
            public.financial_statement_dead_letters.attempt_count + 1,
          last_failed_at = now(),
          error_message = EXCLUDED.error_message;
    END;
  END LOOP;
  UPDATE public.financial_statement_imports
  SET accepted_row_count = accepted_row_count + v_count,
      rejected_row_count = rejected_row_count + v_rejected
  WHERE id = p_import_id;
  RETURN jsonb_build_object('accepted', v_count, 'rejected', v_rejected);
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_bank_statement_rows(
  p_import_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_count integer := 0;
  v_rejected integer := 0;
  v_line integer := 0;
  v_fingerprint text;
BEGIN
  IF NOT finance.reconciliation_gate('bank_statement_ingest_enabled') THEN
    RAISE EXCEPTION 'bank statement ingestion disabled';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'bank rows must be an array';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_line := v_line + 1;
    v_fingerprint := encode(
      extensions.digest(convert_to(v_row::text, 'UTF8'), 'sha256'), 'hex'
    );
    BEGIN
      INSERT INTO public.bank_statement_rows (
        import_id, source_line_number, account_reference, transaction_reference,
        provider_settlement_reference, direction, amount_minor, currency,
        value_date, narration, raw_payload, row_fingerprint
      ) VALUES (
        p_import_id, v_line, v_row->>'account_reference',
        v_row->>'transaction_reference',
        NULLIF(v_row->>'provider_settlement_reference', ''),
        v_row->>'direction', (v_row->>'amount_minor')::bigint,
        upper(v_row->>'currency'), (v_row->>'value_date')::date,
        v_row->>'narration', v_row, v_fingerprint
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected + 1;
      INSERT INTO public.financial_statement_dead_letters (
        import_id, source, source_line_number, payload_hash, raw_payload,
        error_code, error_message
      ) VALUES (
        p_import_id, 'bank', v_line, v_fingerprint, v_row, SQLSTATE, SQLERRM
      )
      ON CONFLICT (source, payload_hash, error_code) DO UPDATE
      SET attempt_count =
            public.financial_statement_dead_letters.attempt_count + 1,
          last_failed_at = now(),
          error_message = EXCLUDED.error_message;
    END;
  END LOOP;
  UPDATE public.financial_statement_imports
  SET accepted_row_count = accepted_row_count + v_count,
      rejected_row_count = rejected_row_count + v_rejected
  WHERE id = p_import_id;
  RETURN jsonb_build_object('accepted', v_count, 'rejected', v_rejected);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_financial_statement_import(
  p_import_id uuid,
  p_expected_row_count integer,
  p_total_debits_minor bigint DEFAULT NULL,
  p_total_credits_minor bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_import public.financial_statement_imports%ROWTYPE;
  v_count integer;
  v_hash text;
BEGIN
  SELECT * INTO v_import
  FROM public.financial_statement_imports
  WHERE id = p_import_id
  FOR UPDATE;
  IF NOT FOUND OR v_import.status <> 'processing' THEN
    RAISE EXCEPTION 'processing import not found';
  END IF;
  IF NOT finance.reconciliation_gate(CASE v_import.source
    WHEN 'razorpay' THEN 'provider_statement_ingest_enabled'
    ELSE 'bank_statement_ingest_enabled' END) THEN
    RAISE EXCEPTION 'statement ingestion disabled';
  END IF;
  IF v_import.source = 'razorpay' THEN
    SELECT count(*), encode(extensions.digest(convert_to(
      COALESCE(string_agg(payload_fingerprint, '' ORDER BY source_line_number), ''),
      'UTF8'), 'sha256'), 'hex')
    INTO v_count, v_hash
    FROM public.provider_statement_rows WHERE import_id = p_import_id;
  ELSE
    SELECT count(*), encode(extensions.digest(convert_to(
      COALESCE(string_agg(row_fingerprint, '' ORDER BY source_line_number), ''),
      'UTF8'), 'sha256'), 'hex')
    INTO v_count, v_hash
    FROM public.bank_statement_rows WHERE import_id = p_import_id;
  END IF;
  IF v_count + v_import.rejected_row_count <> p_expected_row_count THEN
    RAISE EXCEPTION 'statement row count mismatch';
  END IF;
  UPDATE public.financial_statement_imports
  SET status = CASE WHEN v_import.rejected_row_count > 0
        THEN 'dead_letter' ELSE 'completed' END,
      row_count = p_expected_row_count, accepted_row_count = v_count,
      total_debits_minor = p_total_debits_minor,
      total_credits_minor = p_total_credits_minor,
      content_hash = v_hash, finalized_by = auth.uid(), completed_at = now()
  WHERE id = p_import_id;
  RETURN jsonb_build_object(
    'import_id', p_import_id, 'row_count', p_expected_row_count,
    'accepted', v_count, 'rejected', v_import.rejected_row_count,
    'status', CASE WHEN v_import.rejected_row_count > 0
      THEN 'dead_letter' ELSE 'completed' END,
    'content_hash', v_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revise_provider_statement_status(
  p_provider_statement_row_id uuid,
  p_new_status text,
  p_new_payload jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_revision_id uuid;
  v_hash text;
BEGIN
  IF NOT finance.reconciliation_gate('provider_statement_ingest_enabled') THEN
    RAISE EXCEPTION 'provider statement ingestion disabled';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'revision reason required';
  END IF;
  v_hash := encode(
    extensions.digest(convert_to(p_new_payload::text, 'UTF8'), 'sha256'), 'hex'
  );
  PERFORM set_config('app.reconciliation_revision_authorized', 'on', true);
  UPDATE public.provider_statement_rows
  SET provider_status = p_new_status,
      raw_payload = p_new_payload,
      payload_fingerprint = v_hash
  WHERE id = p_provider_statement_row_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider statement row not found'; END IF;
  UPDATE public.provider_statement_row_revisions
  SET revision_reason = p_reason, revised_by = auth.uid()
  WHERE id = (
    SELECT id FROM public.provider_statement_row_revisions
    WHERE provider_statement_row_id = p_provider_statement_row_id
    ORDER BY changed_at DESC LIMIT 1
  )
  RETURNING id INTO v_revision_id;
  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_external_reconciliation_matching(
  p_reconciliation_date date,
  p_shadow_window_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_result jsonb;
BEGIN
  IF NOT finance.reconciliation_gate('reconciliation_matching_enabled') THEN
    RAISE EXCEPTION 'reconciliation matching disabled';
  END IF;
  INSERT INTO public.reconciliation_runs (
    shadow_window_id, reconciliation_date, run_kind, started_by
  ) VALUES (p_shadow_window_id, p_reconciliation_date, 'matching', auth.uid())
  RETURNING id INTO v_run_id;
  BEGIN
    v_result := public.reconcile_external_statements(p_reconciliation_date);
    INSERT INTO public.reconciliation_variance_snapshots (
      run_id, reconciliation_record_id, exception_id, variance_key,
      variance_type, amount_difference_minor, first_seen_at, last_seen_at,
      age_seconds, age_bucket
    )
    SELECT
      v_run_id, r.id, q.id,
      r.provider || ':' || r.reference_type || ':' || r.reference_id,
      r.reference_type, r.difference_minor, q.first_seen_at, now(),
      greatest(0, extract(epoch FROM now() - q.first_seen_at)::bigint),
      CASE
        WHEN now() - q.first_seen_at < interval '4 hours' THEN 'lt_4h'
        WHEN now() - q.first_seen_at < interval '1 day' THEN '4h_24h'
        WHEN now() - q.first_seen_at < interval '3 days' THEN '1d_3d'
        WHEN now() - q.first_seen_at < interval '7 days' THEN '3d_7d'
        ELSE 'gte_7d'
      END
    FROM public.financial_reconciliation_records r
    JOIN public.financial_exception_queue q
      ON q.reconciliation_record_id = r.id
    WHERE r.reconciliation_date = p_reconciliation_date
      AND r.status IN ('open', 'investigating');
    UPDATE public.reconciliation_runs
    SET status = 'completed', result_summary = v_result, completed_at = now()
    WHERE id = v_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.reconciliation_runs
    SET status = 'failed', error_code = SQLSTATE, error_message = SQLERRM,
        completed_at = now()
    WHERE id = v_run_id;
    RAISE;
  END;
  RETURN v_result || jsonb_build_object('run_id', v_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_financial_exception(
  p_exception_id uuid,
  p_action text,
  p_owner_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
DECLARE
  v_row public.financial_exception_queue%ROWTYPE;
  v_new_status text;
  v_event_type text;
BEGIN
  IF NOT finance.reconciliation_gate('reconciliation_matching_enabled') THEN
    RAISE EXCEPTION 'reconciliation exception operations disabled';
  END IF;
  SELECT * INTO v_row FROM public.financial_exception_queue
  WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'financial exception not found'; END IF;
  CASE p_action
    WHEN 'assign' THEN
      IF p_owner_id IS NULL THEN RAISE EXCEPTION 'owner required'; END IF;
      v_new_status := v_row.status; v_event_type := 'assigned';
    WHEN 'acknowledge' THEN
      IF COALESCE(p_owner_id, v_row.owner_id) IS NULL THEN
        RAISE EXCEPTION 'owner required before acknowledgement';
      END IF;
      v_new_status := 'acknowledged'; v_event_type := 'acknowledged';
    WHEN 'investigate' THEN
      v_new_status := 'investigating'; v_event_type := 'investigation_started';
    WHEN 'escalate' THEN
      v_new_status := v_row.status; v_event_type := 'escalated';
    WHEN 'resolve' THEN
      IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
        RAISE EXCEPTION 'resolution reason required';
      END IF;
      v_new_status := 'resolved'; v_event_type := 'resolved';
    WHEN 'dead_letter' THEN
      IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
        RAISE EXCEPTION 'dead-letter reason required';
      END IF;
      v_new_status := 'dead_letter'; v_event_type := 'dead_lettered';
    ELSE RAISE EXCEPTION 'unsupported exception action';
  END CASE;
  UPDATE public.financial_exception_queue
  SET owner_id = COALESCE(p_owner_id, owner_id),
      status = v_new_status,
      acknowledged_at = CASE WHEN p_action = 'acknowledge' THEN now()
        ELSE acknowledged_at END,
      escalated_at = CASE WHEN p_action = 'escalate' THEN now()
        ELSE escalated_at END,
      resolution = CASE WHEN p_action = 'resolve' THEN p_reason
        ELSE resolution END,
      resolved_by = CASE WHEN p_action = 'resolve' THEN auth.uid()
        ELSE resolved_by END,
      resolved_at = CASE WHEN p_action = 'resolve' THEN now()
        ELSE resolved_at END,
      last_error = CASE WHEN p_action = 'dead_letter' THEN p_reason
        ELSE last_error END
  WHERE id = p_exception_id;
  INSERT INTO public.financial_exception_events (
    exception_id, event_type, actor_id, from_status, to_status, reason, evidence
  ) VALUES (
    p_exception_id, v_event_type, auth.uid(), v_row.status, v_new_status,
    p_reason, COALESCE(p_evidence, '{}'::jsonb)
  );
  RETURN jsonb_build_object(
    'exception_id', p_exception_id, 'status', v_new_status,
    'event_type', v_event_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_statement_dead_letter_replay(
  p_dead_letter_id uuid,
  p_authorization_evidence jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT finance.reconciliation_gate('reconciliation_replay_enabled') THEN
    RAISE EXCEPTION 'reconciliation replay disabled';
  END IF;
  IF p_authorization_evidence IS NULL OR p_authorization_evidence = '{}'::jsonb THEN
    RAISE EXCEPTION 'replay authorization evidence required';
  END IF;
  INSERT INTO public.financial_statement_replays (
    dead_letter_id, requested_by, authorization_evidence
  ) VALUES (p_dead_letter_id, auth.uid(), p_authorization_evidence)
  RETURNING id INTO v_id;
  UPDATE public.financial_statement_dead_letters
  SET status = 'replay_requested', replay_requested_by = auth.uid(),
      replay_requested_at = now()
  WHERE id = p_dead_letter_id AND status = 'dead_letter';
  IF NOT FOUND THEN RAISE EXCEPTION 'replayable dead letter not found'; END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_statement_replay_result(
  p_replay_id uuid,
  p_status text,
  p_result_import_id uuid DEFAULT NULL,
  p_result_payload_hash text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
DECLARE
  v_dead_letter_id uuid;
BEGIN
  IF NOT finance.reconciliation_gate('reconciliation_replay_enabled') THEN
    RAISE EXCEPTION 'reconciliation replay disabled';
  END IF;
  IF p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'terminal replay status required';
  END IF;
  UPDATE public.financial_statement_replays
  SET status = p_status,
      result_import_id = p_result_import_id,
      result_payload_hash = p_result_payload_hash,
      error_message = p_error_message,
      completed_at = now()
  WHERE id = p_replay_id AND status = 'requested'
  RETURNING dead_letter_id INTO v_dead_letter_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'requested replay not found'; END IF;
  UPDATE public.financial_statement_dead_letters
  SET status = CASE WHEN p_status = 'completed' THEN 'replayed'
                    WHEN p_status = 'cancelled' THEN 'abandoned'
                    ELSE 'dead_letter' END,
      terminal_reason = CASE WHEN p_status = 'completed' THEN NULL
                             ELSE p_error_message END
  WHERE id = v_dead_letter_id;
  RETURN jsonb_build_object(
    'replay_id', p_replay_id, 'dead_letter_id', v_dead_letter_id,
    'status', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_financial_statement_import(
  text,date,text,text,text,jsonb,date,date,text,bigint,bigint
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_provider_statement_rows(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_bank_statement_rows(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_financial_statement_import(
  uuid,integer,bigint,bigint
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revise_provider_statement_status(
  uuid,text,jsonb,text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_external_reconciliation_matching(date,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_financial_exception(
  uuid,text,uuid,text,jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_statement_dead_letter_replay(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_statement_replay_result(
  uuid,text,uuid,text,text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_financial_statement_import(
  text,date,text,text,text,jsonb,date,date,text,bigint,bigint
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_provider_statement_rows(uuid,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_bank_statement_rows(uuid,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_financial_statement_import(
  uuid,integer,bigint,bigint
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revise_provider_statement_status(
  uuid,text,jsonb,text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_external_reconciliation_matching(date,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_financial_exception(
  uuid,text,uuid,text,jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_statement_dead_letter_replay(uuid,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_statement_replay_result(
  uuid,text,uuid,text,text
) TO service_role;

COMMIT;
