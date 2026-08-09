-- Emergency financial ACL containment.
-- Reversible scope: privileges only; no financial rows are mutated.
BEGIN;

-- PostgreSQL grants these capabilities through broad table grants unless they
-- are explicitly removed. Client roles never need DDL-like privileges.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', schemaname, tablename) AS relation_name
    FROM pg_tables
    WHERE schemaname IN ('public', 'finance')
      AND (
        tablename LIKE 'wallet_%'
        OR tablename LIKE 'loyalty_%'
        OR tablename LIKE 'payment_%'
        OR tablename LIKE 'payout_%'
        OR tablename LIKE 'financial_%'
        OR tablename IN (
          'buyer_wallets', 'seller_settlements', 'refund_requests',
          'refund_attempts', 'cod_transactions'
        )
      )
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE %s FROM PUBLIC, anon, authenticated',
      r.relation_name
    );
  END LOOP;
END;
$$;

-- Financial truth may only be mutated through reviewed functions.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', schemaname, tablename) AS relation_name
    FROM pg_tables
    WHERE schemaname IN ('public', 'finance')
      AND (
        tablename LIKE 'wallet_%'
        OR tablename LIKE 'payment_%'
        OR tablename LIKE 'payout_%'
        OR tablename LIKE 'financial_%'
        OR tablename IN (
          'buyer_wallets', 'seller_settlements', 'refund_attempts',
          'cod_transactions'
        )
      )
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %s FROM PUBLIC, anon, authenticated',
      r.relation_name
    );
  END LOOP;
END;
$$;

-- SECURITY DEFINER implementation helpers must never inherit PostgreSQL's
-- default PUBLIC EXECUTE privilege.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'finance')
      AND (
        n.nspname = 'finance'
        OR p.proname = ANY (ARRAY[
          'wallet_ensure_wallet',
          'wallet_insert_entry',
          'wallet_consume_lots',
          'credit_wallet_cash',
          'restore_wallet_for_order',
          'credit_wallet_from_refund',
          'expire_wallet_lots',
          'apply_wallet_to_checkout_orders',
          'complete_wallet_refund',
          'complete_refund',
          'confirm_orders_after_razorpay_payment_impl',
          'create_settlement_on_delivery_impl',
          'claim_seller_payout',
          'finalize_seller_payout',
          'hold_failed_seller_payout',
          'register_verified_payout_destination',
          'run_financial_reconciliation'
        ])
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      r.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      r.signature
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'finance') THEN
    REVOKE ALL ON SCHEMA finance FROM PUBLIC, anon, authenticated;
    GRANT USAGE ON SCHEMA finance TO service_role;
  END IF;

  -- Money movement remains disabled even if a prior environment drifted.
  IF to_regclass('public.financial_feature_flags') IS NOT NULL THEN
    UPDATE public.financial_feature_flags
    SET enabled = false, updated_at = now()
    WHERE key IN (
      'ledger_read_projection',
      'seller_payout_enabled',
      'razorpay_route_order_transfer_enabled',
      'buyer_withdrawal_enabled',
      'buyer_topup_enabled',
      'buyer_p2p_enabled',
      'wallet_spend_enabled',
      'wallet_issue_enabled',
      'wallet_refund_credit_enabled',
      'cod_payable_offset_enabled'
    );
  END IF;

  IF to_regclass('public.financial_configuration') IS NOT NULL THEN
    UPDATE public.financial_configuration
    SET value = 'disabled', updated_at = now()
    WHERE key = 'provider_payout_mode';
  END IF;
END;
$$;

COMMIT;
