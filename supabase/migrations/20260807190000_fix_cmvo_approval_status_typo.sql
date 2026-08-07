-- ============================================================
-- Fix: create_multi_vendor_orders compared approval_status to
-- 'aproved' (typo), treating every approved product as unavailable.
-- Also: permissive online default when payment config is null,
-- and align JSON error keys with the cart UI.
-- ============================================================

DO $fix$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  -- Idempotent: only rewrite when the typo is present
  IF position('''aproved''' in def) > 0 THEN
    def := replace(def, '''aproved''', '''approved''');
  END IF;

  -- When payment config is missing/null, accept online (same permissive default as COD)
  def := replace(
    def,
    'coalesce((_seller_payment_config->>''accepts_online'')::boolean, false)',
    'coalesce((_seller_payment_config->>''accepts_online'')::boolean, true)'
  );

  -- Align JSON keys with frontend expectations (keep 'items' / 'sellers' for compat)
  def := replace(
    def,
    'return json_build_object(''success'', false, ''error'', ''unavailable_items'', ''items'', to_json(_unavailable_items));',
    'return json_build_object(''success'', false, ''error'', ''unavailable_items'', ''items'', to_json(_unavailable_items), ''unavailable_items'', to_json(_unavailable_items));'
  );
  def := replace(
    def,
    'return json_build_object(''success'', false, ''error'', ''insufficient_stock'', ''items'', to_json(_stock_insufficient));',
    'return json_build_object(''success'', false, ''error'', ''insufficient_stock'', ''items'', to_json(_stock_insufficient), ''stock_insufficient'', to_json(_stock_insufficient));'
  );
  def := replace(
    def,
    'return json_build_object(''success'', false, ''error'', ''price_changed'', ''items'', to_json(_price_changed_items));',
    'return json_build_object(''success'', false, ''error'', ''price_changed'', ''items'', to_json(_price_changed_items), ''price_changed_items'', to_json(_price_changed_items));'
  );
  def := replace(
    def,
    'return json_build_object(''success'', false, ''error'', ''sellers_closed'', ''sellers'', to_json(_closed_sellers));',
    'return json_build_object(''success'', false, ''error'', ''sellers_closed'', ''sellers'', to_json(_closed_sellers), ''closed_sellers'', to_json(_closed_sellers));'
  );
  def := replace(
    def,
    'return json_build_object(''success'', false, ''error'', ''out_of_range'', ''sellers'', to_json(_out_of_range));',
    'return json_build_object(''success'', false, ''error'', ''out_of_range'', ''sellers'', to_json(_out_of_range), ''out_of_range_sellers'', to_json(_out_of_range));'
  );

  EXECUTE def;
END
$fix$;
