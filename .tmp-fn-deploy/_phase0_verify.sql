-- P0 verification checks
SELECT 'acting_as_required' AS check_name,
  (prosrc LIKE '%app.acting_as required%') AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='validate_order_status_transition'
UNION ALL
SELECT 'payment_pending_narrow',
  (prosrc LIKE '%Leaving payment_pending%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='validate_order_status_transition'
UNION ALL
SELECT 'settlement_paid_gate',
  (prosrc LIKE '%Fail-closed: never create settlement%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='create_settlement_on_delivery_impl'
UNION ALL
SELECT 'refund_sm_manual_review',
  (prosrc LIKE '%needs_manual_review%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='enforce_refund_state_machine'
UNION ALL
SELECT 'oae_vault_wake',
  (prosrc LIKE '%service_role_key%' AND prosrc NOT LIKE '%eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='schedule_order_acceptance_expiry'
UNION ALL
SELECT 'stock_restored_col',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='stock_restored')
UNION ALL
SELECT 'refund_no_client_insert',
  NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='refund_requests' AND cmd='INSERT')
UNION ALL
SELECT 'write_audit_event_exists',
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='write_audit_event')
UNION ALL
SELECT 'gmv_rpc_exists',
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='get_admin_settled_gmv')
UNION ALL
SELECT 'buyer_cancel_auto_refund',
  (prosrc LIKE '%Buyer cancelled before seller acceptance%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='buyer_cancel_order'
UNION ALL
SELECT 'rpc_cmvo_exists',
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='create_multi_vendor_orders')
UNION ALL
SELECT 'rpc_seller_advance_exists',
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='seller_advance_order')
UNION ALL
SELECT 'rpc_request_refund_exists',
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='request_refund');
