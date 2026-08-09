-- ============================================================
-- Sociva Credit MVP (part 2): wire checkout, settlement, refunds
-- Depends on: 20260807120312_wallet_mvp_sociva_credit.sql
-- ============================================================

DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(
  uuid, json, text, text, uuid, double precision, double precision, text, text, text,
  numeric, text, numeric, text, uuid[], text, text, integer
);
