-- Explicitly allow authenticated users to call the reviewed financial RPCs.
-- Each mutating RPC below enforces ownership or role checks internally.
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
      AND p.proname = ANY (ARRAY[
        'admin_wallet_liability',
        'approve_refund',
        'compute_child_gateway_refund_amount',
        'confirm_cod_payment',
        'confirm_upi_payment',
        'get_buyer_wallet',
        'get_loyalty_wallet',
        'get_seller_settlement_totals',
        'get_wallet_history',
        'issue_wallet_promo',
        'quote_wallet_application',
        'reject_refund',
        'release_wallet_for_orders',
        'release_wallet_reservation',
        'request_refund',
        'reserve_wallet_credit',
        'verify_seller_payment'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.signature);
  END LOOP;
END;
$$;

COMMIT;
