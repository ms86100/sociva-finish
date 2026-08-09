BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

SELECT has_table(
  'finance',
  'historical_cod_migration_evidence',
  'historical COD changes have exact before/after evidence'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence e
    JOIN public.cod_transactions c
      ON c.order_id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.entity_type = 'cod_transaction'
      AND e.action = 'insert_control'
  ),
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence
    WHERE migration_version = '20260808145400'
      AND entity_type = 'cod_transaction'
      AND action = 'insert_control'
  ),
  'every evidence-qualified COD order has one control record'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM finance.ledger_transactions t
    JOIN finance.historical_cod_migration_evidence e
      ON e.entity_id::text = t.reference_id
    WHERE e.migration_version = '20260808145400'
      AND e.entity_type = 'cod_transaction'
      AND t.reference_type = 'cod_transaction'
  ),
  0::bigint,
  'evidence-only COD backfill creates no historical ledger facts'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence e
    JOIN public.seller_settlements s ON s.id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.action = 'hold_cod_settlement'
      AND s.status = 'on_hold'
      AND s.settlement_status = 'held'
      AND s.eligible_at IS NULL
      AND s.hold_reason = 'historical_cod_not_platform_payable'
  ),
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence
    WHERE migration_version = '20260808145400'
      AND action = 'hold_cod_settlement'
  ),
  'all historical COD settlements are excluded from payout'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence e
    JOIN public.refund_requests r ON r.id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.action = 'route_cod_refund_manual'
      AND r.refund_state = 'needs_manual_review'
      AND r.failure_reason = 'cod_refund_requires_manual_cash_resolution'
  ),
  (
    SELECT count(*)::bigint
    FROM finance.historical_cod_migration_evidence
    WHERE migration_version = '20260808145400'
      AND action = 'route_cod_refund_manual'
  ),
  'COD refunds are routed to manual review'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.financial_feature_flags
    WHERE enabled
      AND key IN (
        'seller_payout_enabled',
        'razorpay_route_order_transfer_enabled',
        'buyer_withdrawal_enabled',
        'buyer_topup_enabled',
        'buyer_p2p_enabled',
        'wallet_spend_enabled',
        'wallet_issue_enabled',
        'wallet_refund_credit_enabled',
        'cod_payable_offset_enabled',
        'provider_payment_create_enabled',
        'provider_payment_confirm_enabled',
        'provider_webhook_capture_enabled',
        'provider_webhook_refund_enabled',
        'provider_refund_processing_enabled',
        'financial_recovery_mutations_enabled'
      )
  ),
  'all money-movement and provider-mutation gates remain disabled'
);

SELECT has_trigger(
  'public',
  'refund_requests',
  'trg_enforce_cod_refund_manual_gate',
  'COD refund manual gate is installed'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.orders(
  id, buyer_id, seller_id, status, total_amount, payment_type, payment_status
)
VALUES (
  '30000000-0000-4000-8000-000000000003',
  '2098a5b4-ccb4-4f56-ae71-51e59b8b5c7f',
  '68a6cc09-50a7-4c62-a4c5-09a56a62f2bd',
  'completed',
  10,
  'cod',
  'paid'
);
INSERT INTO public.refund_requests(
  id, order_id, buyer_id, seller_id, amount, reason, refund_state
)
VALUES (
  '40000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000003',
  '2098a5b4-ccb4-4f56-ae71-51e59b8b5c7f',
  '68a6cc09-50a7-4c62-a4c5-09a56a62f2bd',
  10,
  'COD manual-gate certification fixture',
  'needs_manual_review'
);
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  $$
    UPDATE public.refund_requests r
    SET refund_state = 'refund_processing'
    FROM public.orders o
    WHERE o.id = r.order_id
      AND lower(COALESCE(o.payment_type, '')) = 'cod'
      AND r.refund_state = 'needs_manual_review'
  $$,
  'P0001',
  'COD refund requires manual resolution while wallet refund credit is disabled',
  'disabled wallet refund credit blocks COD refund processing'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.buyer_wallets(user_id)
VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');

INSERT INTO public.wallet_credit_lots(
  user_id, bucket, original_amount, remaining_amount
)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'cash', 10, 10),
  ('20000000-0000-4000-8000-000000000002', 'cash', 20, 20);

INSERT INTO public.wallet_ledger_txns(user_id, type)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'adjust'),
  ('20000000-0000-4000-8000-000000000002', 'adjust');

INSERT INTO public.wallet_ledger_entries(
  txn_id, account, direction, amount
)
SELECT id, 'wallet_cash', 'debit', 1
FROM public.wallet_ledger_txns
WHERE user_id IN (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);

INSERT INTO public.wallet_reservations(user_id, cash_amount)
VALUES
  ('10000000-0000-4000-8000-000000000001', 1),
  ('20000000-0000-4000-8000-000000000002', 1);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.buyer_wallets
    WHERE user_id IN (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'authenticated buyer cannot read another buyer wallet'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.wallet_credit_lots
    WHERE user_id IN (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'authenticated buyer cannot read another buyer credit lot'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.wallet_ledger_txns
    WHERE user_id IN (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'authenticated buyer cannot read another buyer wallet transaction'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.wallet_ledger_entries e
    JOIN public.wallet_ledger_txns t ON t.id = e.txn_id
    WHERE t.user_id IN (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'authenticated buyer cannot read another buyer wallet entry'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.wallet_reservations
    WHERE user_id IN (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'authenticated buyer cannot read another buyer reservation'
);

SELECT throws_ok(
  $$
    UPDATE public.buyer_wallets
    SET cash_available = cash_available + 1
    WHERE user_id = '10000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  NULL,
  'authenticated buyer cannot directly mutate own wallet'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
