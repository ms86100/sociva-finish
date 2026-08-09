begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select has_function(
  'public',
  'financial_runtime_preflight',
  array[]::text[],
  'financial runtime preflight is deployed'
);

with required(name) as (
  values
    ('wallet_financial_hardening'),
    ('wallet_financial_operations'),
    ('fix_partial_unique_on_conflict_loyalty_wallet'),
    ('emergency_financial_acl_containment'),
    ('attempt_aware_payment_truth'),
    ('cod_and_payout_release_gates'),
    ('canonical_runtime_journals'),
    ('external_reconciliation_and_evidence'),
    ('refund_liability_chargeback_boundaries'),
    ('revoke_complete_refund_public'),
    ('revoke_fail_refund_public'),
    ('financial_function_anon_acl'),
    ('restore_reviewed_financial_client_rpcs'),
    ('financial_runtime_preflight'),
    ('wallet_rpc_kill_switch_enforcement'),
    ('financial_capability_enablement_gates')
),
missing as (
  select required.name
  from required
  where not exists (
    select 1
    from supabase_migrations.schema_migrations applied
    where applied.name = required.name
  )
)
select is(
  (select count(*)::bigint from missing),
  0::bigint,
  'every ordered repository wallet migration is recorded'
);

select ok(
  (public.financial_runtime_preflight()->>'payment_ready')::boolean,
  'payment runtime is complete'
);
select ok(
  (public.financial_runtime_preflight()->>'payout_ready')::boolean,
  'payout runtime is complete'
);
select ok(
  (public.financial_runtime_preflight()->>'refund_ready')::boolean,
  'refund runtime is complete'
);
select ok(
  (public.financial_runtime_preflight()->>'reconciliation_ready')::boolean,
  'reconciliation runtime is complete'
);
select ok(
  (public.financial_runtime_preflight()->>'money_movement_disabled')::boolean,
  'all money movement remains disabled'
);

select * from finish();
rollback;
