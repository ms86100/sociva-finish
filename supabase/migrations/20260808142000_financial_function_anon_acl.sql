-- Remove PostgreSQL's default PUBLIC EXECUTE from financial SECURITY DEFINER
-- functions. Authenticated grants remain intact for reviewed user workflows.
BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        p.proname ILIKE '%payment%'
        OR p.proname ILIKE '%refund%'
        OR p.proname ILIKE '%wallet%'
        OR p.proname ILIKE '%settlement%'
        OR p.proname ILIKE '%payout%'
      )
      AND p.proname <> 'get_public_payment_mode'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END;
$$;

-- These are implementation helpers or worker-only state transitions, not
-- authenticated client APIs.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'commit_wallet_for_orders',
        'commit_wallet_reservation',
        'complete_refund',
        'complete_refund_by_gateway_id',
        'complete_wallet_refund',
        'credit_wallet_from_refund',
        'enqueue_seller_settlement_notification',
        'enqueue_settlement_notification',
        'expire_wallet_lots',
        'fail_refund',
        'fn_auto_refund_on_seller_cancel',
        'fn_link_construction_to_payment',
        'fn_populate_payment_record',
        'fn_populate_payment_record_impl',
        'fn_wallet_on_order_cancelled',
        'freeze_order_amount_after_payment',
        'guard_order_payment_status',
        'guard_refund_terminal_state',
        'loyalty_reconcile_wallet',
        'loyalty_ensure_wallet',
        'resolve_refund_gateway_context',
        'restore_wallet_for_order',
        'set_payment_record_society_id',
        'sync_maintenance_payment_to_income',
        'trg_create_settlement_on_delivery',
        'validate_and_normalize_payment_record',
        'validate_payment_collection',
        'validate_payment_mode',
        'validate_settlement_release',
        'validate_settlement_status',
        'wallet_consume_lots',
        'wallet_ensure_wallet',
        'wallet_insert_entry'
      ])
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      r.signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END;
$$;

COMMIT;
