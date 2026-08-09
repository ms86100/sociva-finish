begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

create temp table wallet_rpc_baseline as
select
  (select count(*) from public.wallet_reservations) as reservations,
  (select count(*) from public.wallet_credit_lots) as credit_lots,
  (select count(*) from public.wallet_ledger_txns) as ledger_txns;

select is(
  (
    select count(*)::bigint
    from public.financial_feature_flags
    where key in ('wallet_spend_enabled', 'wallet_issue_enabled')
      and enabled
  ),
  0::bigint,
  'wallet spend and issuance flags remain disabled'
);

select is(
  (
    select count(*)::bigint
    from (
      values
        ('public.reserve_wallet_credit(numeric,text,text,uuid[])'),
        ('public.issue_wallet_promo(uuid,numeric,timestamp with time zone,text,text,text,text)')
    ) signatures(signature)
    where has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  2::bigint,
  'reviewed authenticated entrypoints remain callable'
);

select is(
  (
    select count(*)::bigint
    from (
      values
        ('public.commit_wallet_reservation(uuid,uuid[])'),
        ('public.commit_wallet_for_orders(uuid[])'),
        ('public.release_wallet_reservation(uuid)'),
        ('public.release_wallet_for_orders(uuid[])')
    ) signatures(signature)
    where has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  0::bigint,
  'authenticated cannot execute worker wallet helpers'
);

select is(
  (
    select count(*)::bigint
    from (
      values
        ('public.commit_wallet_reservation(uuid,uuid[])'),
        ('public.commit_wallet_for_orders(uuid[])'),
        ('public.release_wallet_reservation(uuid)'),
        ('public.release_wallet_for_orders(uuid[])')
    ) signatures(signature)
    where has_function_privilege('service_role', signature, 'EXECUTE')
  ),
  4::bigint,
  'service role retains intended worker helper access'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'reserve_wallet_credit',
        'issue_wallet_promo',
        'commit_wallet_reservation',
        'commit_wallet_for_orders',
        'release_wallet_reservation',
        'release_wallet_for_orders'
      )
      and p.prosecdef
      and exists (
        select 1
        from unnest(p.proconfig) setting
        where setting like 'search_path=%'
          and setting not like '%"$user"%'
      )
  ),
  6::bigint,
  'all six RPCs retain fixed search paths'
);

select throws_ok(
  $$
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
      true
    );
    select public.reserve_wallet_credit(1, 'buyer-disabled', null, null)
  $$,
  'financial feature wallet_spend_enabled is disabled',
  'disabled spend blocks buyer reservation'
);

select throws_ok(
  $$
    select set_config(
      'request.jwt.claims',
      '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
      true
    );
    select public.reserve_wallet_credit(1, 'seller-disabled', null, null)
  $$,
  'financial feature wallet_spend_enabled is disabled',
  'disabled spend blocks seller reservation'
);

select throws_ok(
  $$
    select set_config(
      'request.jwt.claims',
      '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
      true
    );
    select public.reserve_wallet_credit(1, 'admin-disabled', null, null)
  $$,
  'financial feature wallet_spend_enabled is disabled',
  'disabled spend blocks admin reservation'
);

select throws_ok(
  $$
    select set_config(
      'request.jwt.claims',
      '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
      true
    );
    select public.issue_wallet_promo(
      '10000000-0000-0000-0000-000000000001',
      1,
      now() + interval '1 day',
      'certification',
      'admin-issue-disabled',
      null,
      'certification'
    )
  $$,
  'financial feature wallet_issue_enabled is disabled',
  'disabled issuance blocks admin promo credit'
);

select throws_ok(
  $$
    select public.commit_wallet_reservation(
      '00000000-0000-0000-0000-000000000000',
      null
    )
  $$,
  'financial feature wallet_spend_enabled is disabled',
  'disabled spend blocks service commit entrypoint'
);

select is(
  (select count(*) from public.wallet_reservations),
  (select reservations from wallet_rpc_baseline),
  'disabled calls create no wallet reservations'
);

select is(
  (select count(*) from public.wallet_credit_lots),
  (select credit_lots from wallet_rpc_baseline),
  'disabled calls create no wallet credit lots'
);

select is(
  (select count(*) from public.wallet_ledger_txns),
  (select ledger_txns from wallet_rpc_baseline),
  'disabled calls create no wallet ledger transactions'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%wallet%_impl'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  0::bigint,
  'implementation functions are not client executable'
);

select * from finish();
rollback;
