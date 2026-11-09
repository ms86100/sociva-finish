begin;

create extension if not exists pgtap with schema extensions;
select plan(43);

select is(
  (select count(*) from public.financial_feature_flags
   where key like '%reconciliation%'
     and key in (
       'reconciliation_projection_enabled',
       'provider_statement_ingest_enabled',
       'bank_statement_ingest_enabled',
       'reconciliation_matching_enabled',
       'reconciliation_replay_enabled'
     )
     and enabled),
  0::bigint,
  'all new reconciliation gates default off'
);
select ok(exists(select 1 from public.financial_feature_flags where key =
  'reconciliation_projection_enabled'), 'projection gate exists');
select ok(exists(select 1 from public.financial_feature_flags where key =
  'provider_statement_ingest_enabled'), 'provider ingest gate exists');
select ok(exists(select 1 from public.financial_feature_flags where key =
  'bank_statement_ingest_enabled'), 'bank ingest gate exists');
select ok(exists(select 1 from public.financial_feature_flags where key =
  'reconciliation_matching_enabled'), 'matching gate exists');
select ok(exists(select 1 from public.financial_feature_flags where key =
  'reconciliation_replay_enabled'), 'replay gate exists');

select has_table('public', 'reconciliation_shadow_windows',
  'shadow windows are durable');
select has_table('public', 'reconciliation_runs',
  'reconciliation runs are durable');
select has_table('public', 'reconciliation_variance_snapshots',
  'variance aging snapshots are durable');
select has_table('public', 'financial_exception_events',
  'exception lifecycle is append-only');
select has_table('public', 'financial_statement_dead_letters',
  'statement dead letters are durable');
select has_table('public', 'financial_statement_replays',
  'replay requests are durable');

select ok(to_regprocedure('public.get_reconciliation_projection(date)') is not null,
  'read-only projection exists');
select ok(to_regprocedure(
  'public.begin_financial_statement_import(text,date,text,text,text,jsonb,date,date,text,bigint,bigint)'
) is not null, 'begin import function exists');
select ok(to_regprocedure(
  'public.ingest_provider_statement_rows(uuid,jsonb)'
) is not null, 'provider ingest function exists');
select ok(to_regprocedure(
  'public.ingest_bank_statement_rows(uuid,jsonb)'
) is not null, 'bank ingest function exists');
select ok(to_regprocedure(
  'public.complete_financial_statement_import(uuid,integer,bigint,bigint)'
) is not null, 'complete import function exists');
select ok(to_regprocedure(
  'public.revise_provider_statement_status(uuid,text,jsonb,text)'
) is not null, 'provider revision function exists');
select ok(to_regprocedure(
  'public.run_external_reconciliation_matching(date,uuid)'
) is not null, 'matching function exists');
select ok(to_regprocedure(
  'public.transition_financial_exception(uuid,text,uuid,text,jsonb)'
) is not null, 'exception transition function exists');
select ok(to_regprocedure(
  'public.request_statement_dead_letter_replay(uuid,jsonb)'
) is not null, 'replay request function exists');
select ok(to_regprocedure(
  'public.record_statement_replay_result(uuid,text,uuid,text,text)'
) is not null, 'replay result function exists');

select is(
  (select provolatile::text from pg_proc
   where oid = 'public.get_reconciliation_projection(date)'::regprocedure),
  's',
  'projection is declared stable'
);
select ok(
  (select pg_get_functiondef(
    'public.get_reconciliation_projection(date)'::regprocedure
  )) !~* '\m(insert|update|delete|merge|call|perform|http|net|fetch)\M',
  'projection contains no write or outbound-call primitive'
);
select is(
  has_function_privilege(
    'anon', 'public.get_reconciliation_projection(date)', 'EXECUTE'
  ),
  false,
  'anon cannot execute projection'
);
select is(
  has_function_privilege(
    'authenticated', 'public.get_reconciliation_projection(date)', 'EXECUTE'
  ),
  false,
  'authenticated cannot execute projection'
);
select is(
  (select count(*) from (
    values
      ('public.reconciliation_shadow_windows'),
      ('public.reconciliation_runs'),
      ('public.reconciliation_variance_snapshots'),
      ('public.financial_exception_events'),
      ('public.financial_statement_dead_letters'),
      ('public.financial_statement_replays')
  ) as x(rel)
  where has_table_privilege('anon', rel, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', rel, 'SELECT,INSERT,UPDATE,DELETE')),
  0::bigint,
  'client roles have no reconciliation operations table privileges'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'reconciliation_shadow_windows', 'reconciliation_runs',
       'reconciliation_variance_snapshots', 'financial_exception_events',
       'financial_statement_dead_letters', 'financial_statement_replays'
     )
     and c.relrowsecurity),
  6::bigint,
  'all new reconciliation tables have RLS'
);
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public'
     and table_name = 'financial_statement_imports'
     and column_name in (
       'parent_import_id', 'parser_version', 'period_start', 'period_end',
       'account_reference_masked', 'opening_balance_minor',
       'closing_balance_minor', 'total_debits_minor', 'total_credits_minor',
       'accepted_row_count', 'rejected_row_count', 'manifest', 'content_hash',
       'finalized_by'
     )),
  14::bigint,
  'import lineage and control totals are present'
);
select has_column('public', 'provider_statement_rows', 'source_line_number',
  'provider source line is retained');
select has_column('public', 'bank_statement_rows', 'row_fingerprint',
  'bank row fingerprint is retained');
select has_column('public', 'provider_statement_row_revisions', 'revision_reason',
  'provider revision reason is retained');
select is(
  (select count(*) from pg_trigger
   where not tgisinternal
     and tgname in (
       'trg_guard_statement_import',
       'trg_guard_provider_statement_insert',
       'trg_guard_bank_statement_insert',
       'trg_guard_provider_statement_immutability',
       'trg_guard_bank_statement_immutability'
     )),
  5::bigint,
  'lineage and immutability triggers are installed'
);

select throws_ok(
  $$select public.get_reconciliation_projection(current_date)$$,
  'reconciliation projection disabled',
  'projection fails closed'
);
select throws_ok(
  $$select public.begin_financial_statement_import(
    'razorpay', current_date, null, repeat('a',64), 'test'
  )$$,
  'provider_statement_ingest_enabled disabled',
  'provider import fails closed'
);
select throws_ok(
  $$select public.begin_financial_statement_import(
    'bank', current_date, null, repeat('a',64), 'test'
  )$$,
  'bank_statement_ingest_enabled disabled',
  'bank import fails closed'
);
select throws_ok(
  $$select public.ingest_provider_statement_rows(
    '00000000-0000-0000-0000-000000000000', '[]'::jsonb
  )$$,
  'provider statement ingestion disabled',
  'provider rows fail closed'
);
select throws_ok(
  $$select public.ingest_bank_statement_rows(
    '00000000-0000-0000-0000-000000000000', '[]'::jsonb
  )$$,
  'bank statement ingestion disabled',
  'bank rows fail closed'
);
select throws_ok(
  $$select public.run_external_reconciliation_matching(current_date, null)$$,
  'reconciliation matching disabled',
  'matching fails closed'
);
select throws_ok(
  $$select public.transition_financial_exception(
    '00000000-0000-0000-0000-000000000000', 'acknowledge'
  )$$,
  'reconciliation exception operations disabled',
  'exception operations fail closed'
);
select throws_ok(
  $$select public.request_statement_dead_letter_replay(
    '00000000-0000-0000-0000-000000000000',
    '{"ticket":"not-executed"}'::jsonb
  )$$,
  'reconciliation replay disabled',
  'replay fails closed'
);
select is(
  (select count(*) from cron.job
   where lower(coalesce(jobname, '')) like '%reconcil%'
      or lower(coalesce(command, '')) like '%reconcil%'),
  0::bigint,
  'migration schedules no reconciliation job'
);
select is(
  (select count(*) from public.financial_feature_flags
   where key in (
     'seller_payout_enabled', 'buyer_withdrawal_enabled',
     'buyer_topup_enabled', 'buyer_p2p_enabled',
     'wallet_spend_enabled', 'wallet_issue_enabled',
     'wallet_refund_credit_enabled', 'cod_payable_offset_enabled',
     'provider_payment_create_enabled', 'provider_payment_confirm_enabled',
     'provider_webhook_capture_enabled', 'provider_webhook_refund_enabled',
     'provider_refund_processing_enabled',
     'financial_recovery_mutations_enabled',
     'reconciliation_projection_enabled',
     'provider_statement_ingest_enabled',
     'bank_statement_ingest_enabled',
     'reconciliation_matching_enabled',
     'reconciliation_replay_enabled'
   ) and enabled),
  0::bigint,
  'all movement and reconciliation gates remain off'
);

select * from finish();
rollback;
