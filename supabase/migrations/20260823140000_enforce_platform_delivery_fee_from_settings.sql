-- Enforce platform delivery fee from system_settings (ignore client _delivery_fee).
-- Buyers were seeing stale ₹10 from bootstrap cache while admin set base_delivery_fee=5.

CREATE OR REPLACE FUNCTION public.resolve_platform_delivery_fee(
  _fulfillment_type text,
  _seller_groups json
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _base_fee numeric;
  _free_threshold numeric;
  _cart_subtotal numeric := 0;
BEGIN
  IF coalesce(_fulfillment_type, 'delivery') <> 'delivery' THEN
    RETURN 0;
  END IF;

  SELECT coalesce(nullif(ss.value #>> '{}', '')::numeric, 20)
    INTO _base_fee
  FROM public.system_settings ss
  WHERE ss.key = 'base_delivery_fee';

  IF _base_fee IS NULL THEN
    _base_fee := 20;
  END IF;

  SELECT coalesce(nullif(ss.value #>> '{}', '')::numeric, 500)
    INTO _free_threshold
  FROM public.system_settings ss
  WHERE ss.key = 'free_delivery_threshold';

  IF _free_threshold IS NULL THEN
    _free_threshold := 500;
  END IF;

  SELECT coalesce(sum(((_item->>'quantity')::int) * ((_item->>'unit_price')::numeric)), 0)
    INTO _cart_subtotal
  FROM json_array_elements(_seller_groups) AS g,
       json_array_elements(g->'items') AS _item;

  IF _cart_subtotal >= _free_threshold THEN
    RETURN 0;
  END IF;

  RETURN greatest(0, _base_fee);
END;
$function$;

COMMENT ON FUNCTION public.resolve_platform_delivery_fee(text, json) IS
  'Canonical platform delivery fee from system_settings.base_delivery_fee + free_delivery_threshold.';

-- Inject resolve into create_multi_vendor_orders (overwrite client _delivery_fee after auth).
DO $outer$
DECLARE
  def text;
  old_snip text;
  new_snip text;
BEGIN
  old_snip := $a$
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  if _payment_status = 'pending' and _payment_method <> 'cod' then
$a$;

  new_snip := $b$
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- P0: never trust client delivery fee — resolve from admin system_settings
  _delivery_fee := public.resolve_platform_delivery_fee(
    coalesce(_fulfillment_type, 'delivery'),
    _seller_groups
  );

  if _payment_status = 'pending' and _payment_method <> 'cod' then
$b$;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF strpos(def, 'resolve_platform_delivery_fee') > 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders already enforces platform delivery fee';
    RETURN;
  END IF;

  IF strpos(def, old_snip) = 0 THEN
    RAISE EXCEPTION 'expected auth/payment_status snippet not found in create_multi_vendor_orders';
  END IF;

  def := replace(def, old_snip, new_snip);
  EXECUTE def;
END
$outer$;
