-- Reviewed rollback for migration 20260808150000.
-- Run only while all reconciliation gates remain disabled.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.financial_feature_flags
    WHERE enabled
      AND key IN (
        'reconciliation_projection_enabled',
        'provider_statement_ingest_enabled',
        'bank_statement_ingest_enabled',
        'reconciliation_matching_enabled',
        'reconciliation_replay_enabled'
      )
  ) THEN
    RAISE EXCEPTION 'rollback refused: a reconciliation gate is enabled';
  END IF;

  IF EXISTS (SELECT 1 FROM public.reconciliation_shadow_windows)
     OR EXISTS (SELECT 1 FROM public.reconciliation_runs)
     OR EXISTS (SELECT 1 FROM public.reconciliation_variance_snapshots)
     OR EXISTS (SELECT 1 FROM public.financial_exception_events)
     OR EXISTS (SELECT 1 FROM public.financial_statement_dead_letters)
     OR EXISTS (SELECT 1 FROM public.financial_statement_replays) THEN
    RAISE EXCEPTION 'rollback refused: reconciliation control data exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_statement_import
  ON public.financial_statement_imports;
DROP TRIGGER IF EXISTS trg_guard_provider_statement_insert
  ON public.provider_statement_rows;
DROP TRIGGER IF EXISTS trg_guard_bank_statement_insert
  ON public.bank_statement_rows;
DROP TRIGGER IF EXISTS trg_guard_provider_statement_immutability
  ON public.provider_statement_rows;
DROP TRIGGER IF EXISTS trg_guard_bank_statement_immutability
  ON public.bank_statement_rows;

DROP FUNCTION IF EXISTS public.record_statement_replay_result(
  uuid,text,uuid,text,text
);
DROP FUNCTION IF EXISTS public.request_statement_dead_letter_replay(uuid,jsonb);
DROP FUNCTION IF EXISTS public.transition_financial_exception(
  uuid,text,uuid,text,jsonb
);
DROP FUNCTION IF EXISTS public.run_external_reconciliation_matching(date,uuid);
DROP FUNCTION IF EXISTS public.revise_provider_statement_status(
  uuid,text,jsonb,text
);
DROP FUNCTION IF EXISTS public.complete_financial_statement_import(
  uuid,integer,bigint,bigint
);
DROP FUNCTION IF EXISTS public.ingest_bank_statement_rows(uuid,jsonb);
DROP FUNCTION IF EXISTS public.ingest_provider_statement_rows(uuid,jsonb);
DROP FUNCTION IF EXISTS public.begin_financial_statement_import(
  text,date,text,text,text,jsonb,date,date,text,bigint,bigint
);
DROP FUNCTION IF EXISTS public.get_reconciliation_projection(date);
DROP FUNCTION IF EXISTS finance.guard_statement_row_immutability();
DROP FUNCTION IF EXISTS finance.guard_statement_row_insert();
DROP FUNCTION IF EXISTS finance.guard_statement_import();
DROP FUNCTION IF EXISTS finance.reconciliation_gate(text);

DROP TABLE IF EXISTS public.financial_statement_replays;
DROP TABLE IF EXISTS public.financial_statement_dead_letters;
DROP TABLE IF EXISTS public.financial_exception_events;
DROP TABLE IF EXISTS public.reconciliation_variance_snapshots;
DROP TABLE IF EXISTS public.reconciliation_runs;
DROP TABLE IF EXISTS public.reconciliation_shadow_windows;

DROP INDEX IF EXISTS public.uq_provider_import_source_line;
DROP INDEX IF EXISTS public.uq_bank_import_source_line;
DROP INDEX IF EXISTS public.uq_bank_row_fingerprint;

ALTER TABLE public.provider_statement_row_revisions
  DROP COLUMN IF EXISTS revision_reason,
  DROP COLUMN IF EXISTS revised_by;
ALTER TABLE public.bank_statement_rows
  DROP COLUMN IF EXISTS source_line_number,
  DROP COLUMN IF EXISTS row_fingerprint;
ALTER TABLE public.provider_statement_rows
  DROP COLUMN IF EXISTS source_line_number;
ALTER TABLE public.financial_statement_imports
  DROP COLUMN IF EXISTS parent_import_id,
  DROP COLUMN IF EXISTS parser_version,
  DROP COLUMN IF EXISTS period_start,
  DROP COLUMN IF EXISTS period_end,
  DROP COLUMN IF EXISTS account_reference_masked,
  DROP COLUMN IF EXISTS opening_balance_minor,
  DROP COLUMN IF EXISTS closing_balance_minor,
  DROP COLUMN IF EXISTS total_debits_minor,
  DROP COLUMN IF EXISTS total_credits_minor,
  DROP COLUMN IF EXISTS accepted_row_count,
  DROP COLUMN IF EXISTS rejected_row_count,
  DROP COLUMN IF EXISTS manifest,
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS finalized_by;

DELETE FROM public.financial_feature_flags
WHERE key IN (
  'reconciliation_projection_enabled',
  'provider_statement_ingest_enabled',
  'bank_statement_ingest_enabled',
  'reconciliation_matching_enabled',
  'reconciliation_replay_enabled'
);

COMMIT;
