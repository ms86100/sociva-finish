-- ============================================================
-- P4: Partial refunds for checkout groups (child share of capture)
-- - Track amount_refunded on checkout_groups
-- - Compute child gateway refund (last-child gets remainder)
-- - Fix auto-refund refund_state=approved (processor gate)
-- - complete_refund: stamp group totals; fix payment_status; no double wallet/loyalty
-- - Wallet/loyalty cancel triggers also fire on rejected
-- ============================================================

