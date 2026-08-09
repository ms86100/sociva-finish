begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_schema('finance', 'finance schema exists');
select has_table('finance', 'ledger_transactions', 'canonical transactions exist');
select has_table('finance', 'ledger_entries', 'canonical entries exist');
select has_table('public', 'payment_attempts', 'attempt-aware payment truth exists');
select has_table('public', 'provider_statement_rows', 'provider evidence staging exists');
select has_table('public', 'bank_statement_rows', 'bank evidence staging exists');
select has_table('public', 'seller_liability_entries', 'seller liabilities exist');

select is(
  (
    select count(*)::bigint
    from finance.journal_integrity_violations
  ),
  0::bigint,
  'all posted journals are balanced'
);

select is(
  (
    select count(*)::bigint
    from pg_tables
    where schemaname in ('public', 'finance')
      and (
        tablename like 'wallet_%'
        or tablename like 'payment_%'
        or tablename like 'financial_%'
        or tablename in ('buyer_wallets', 'seller_settlements')
      )
      and (
        has_table_privilege(
          'anon', format('%I.%I', schemaname, tablename),
          'TRUNCATE,TRIGGER,REFERENCES'
        )
        or has_table_privilege(
          'authenticated', format('%I.%I', schemaname, tablename),
          'TRUNCATE,TRIGGER,REFERENCES'
        )
      )
  ),
  0::bigint,
  'client roles have no DDL-like financial privileges'
);

select is(
  (
    select count(*)::bigint
    from public.financial_feature_flags
    where key in (
      'seller_payout_enabled', 'buyer_withdrawal_enabled',
      'buyer_topup_enabled', 'buyer_p2p_enabled',
      'wallet_spend_enabled', 'wallet_issue_enabled',
      'wallet_refund_credit_enabled', 'cod_payable_offset_enabled'
    )
      and enabled
  ),
  0::bigint,
  'all money movement switches remain disabled'
);

select is(
  (
    select value
    from public.financial_configuration
    where key = 'provider_payout_mode'
  ),
  'disabled',
  'provider payout mode is disabled'
);

select lives_ok(
  $$
    select finance.post_journal(
      'ADJUSTMENT', 'certification', 'balanced',
      'certification:balanced',
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'debit', 'amount_minor', 1
        ),
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'credit', 'amount_minor', 1
        )
      ),
      'Certification balanced journal', '{}'::jsonb, null, null
    )
  $$,
  'balanced journal posts'
);

select throws_like(
  $$
    select finance.post_journal(
      'ADJUSTMENT', 'certification', 'unbalanced',
      'certification:unbalanced',
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'debit', 'amount_minor', 2
        ),
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'credit', 'amount_minor', 1
        )
      ),
      'Certification unbalanced journal', '{}'::jsonb, null, null
    )
  $$,
  'unbalanced journal:%',
  'unbalanced journal is rejected'
);

select lives_ok(
  $$
    select finance.post_journal(
      'ADJUSTMENT', 'certification', 'idempotent',
      'certification:idempotent:v2',
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'debit', 'amount_minor', 1
        ),
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'credit', 'amount_minor', 1
        )
      ),
      'Certification idempotent journal', '{}'::jsonb, null, null
    );
    select finance.post_journal(
      'ADJUSTMENT', 'certification', 'idempotent',
      'certification:idempotent:v2',
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'debit', 'amount_minor', 1
        ),
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'credit', 'amount_minor', 1
        )
      ),
      'Certification idempotent journal', '{}'::jsonb, null, null
    )
  $$,
  'identical idempotent journal replay succeeds'
);

select throws_ok(
  $$
    select finance.post_journal(
      'ADJUSTMENT', 'certification', 'idempotent',
      'certification:idempotent:v2',
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'debit', 'amount_minor', 2
        ),
        jsonb_build_object(
          'account_code', 'financial_suspense',
          'direction', 'credit', 'amount_minor', 2
        )
      ),
      'Changed payload', '{}'::jsonb, null, null
    )
  $$,
  'idempotency key payload mismatch',
  'changed idempotent payload is rejected'
);

select throws_ok(
  $$
    insert into finance.ledger_entries(
      transaction_id, account_id, direction, amount_minor
    )
    select t.id, a.id, 'debit', 1
    from finance.ledger_transactions t
    cross join finance.ledger_accounts a
    where t.idempotency_key = 'certification:idempotent:v2'
      and a.code = 'financial_suspense'
  $$,
  'posted financial journals are immutable',
  'entries cannot be appended to posted journals'
);

select is(
  (
    select count(*)::bigint
    from public.seller_settlements s
    join public.orders o on o.id = s.order_id
    where lower(coalesce(o.payment_type, '')) in (
      'cod', 'cash', 'cash_on_delivery'
    )
      and s.settlement_status in ('eligible', 'processing', 'settled')
      and s.razorpay_transfer_id is not null
  ),
  0::bigint,
  'COD orders have no provider payout'
);

select is(
  (
    select count(*)::bigint
    from public.payout_attempts pa
    join public.seller_settlements s on s.id = pa.settlement_id
    left join finance.ledger_transactions t
      on t.idempotency_key = 'payout-reserve:' || pa.id::text
    where t.id is null
  ),
  0::bigint,
  'every payout attempt has a reservation journal'
);

select is(
  (
    select count(*)::bigint
    from public.refund_attempts ra
    left join public.refund_allocation_snapshots rs
      on rs.refund_id = ra.refund_id
    where rs.id is null
  ),
  0::bigint,
  'every refund attempt has an immutable allocation snapshot'
);

select * from finish();
rollback;
