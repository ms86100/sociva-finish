CREATE OR REPLACE FUNCTION public.verify_inventory_hold_no_leak(p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_seller uuid; v_buyer uuid; v_product uuid; v_order1 uuid; v_order2 uuid; v_item1 uuid;
  v_stock_before int := 5; v_stock int; v_checks jsonb := '[]'::jsonb; v_ok boolean := true;
  v_hold jsonb; v_restored boolean; v_category text;
BEGIN
  SELECT id INTO v_seller FROM public.seller_profiles LIMIT 1;
  SELECT id INTO v_buyer FROM public.profiles LIMIT 1;
  IF v_seller IS NULL OR v_buyer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_fixture_seller_or_buyer');
  END IF;

  SELECT p.category INTO v_category FROM public.products p WHERE p.seller_id = v_seller LIMIT 1;
  IF v_category IS NULL THEN
    SELECT COALESCE(sp.primary_group, 'groceries') INTO v_category FROM public.seller_profiles sp WHERE sp.id = v_seller;
  END IF;

  INSERT INTO public.products (seller_id, name, price, category, stock_quantity, is_available, approval_status)
  VALUES (v_seller, '_hold_verify_' || gen_random_uuid()::text, 10, v_category, v_stock_before, true, 'approved')
  RETURNING id INTO v_product;

  INSERT INTO public.orders (buyer_id, seller_id, status, payment_status, total_amount, payment_type)
  VALUES (v_buyer, v_seller, 'payment_pending', 'pending', 10, 'online') RETURNING id INTO v_order1;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, stock_restored)
  VALUES (v_order1, v_product, 'hold_verify_item', 2, 10, false) RETURNING id INTO v_item1;

  UPDATE public.products SET stock_quantity = stock_quantity - 2 WHERE id = v_product;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','hold_after_cmvo','stock',v_stock,'expect',3,'ok',v_stock=3));
  IF v_stock <> 3 THEN v_ok := false; END IF;

  PERFORM set_config('app.acting_as', 'system', true);
  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_order1;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  SELECT stock_restored INTO v_restored FROM public.order_items WHERE id = v_item1;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','cancel_restores','stock',v_stock,'expect',5,'stock_restored',v_restored,'ok',v_stock=5 AND v_restored IS TRUE));
  IF v_stock <> 5 OR v_restored IS NOT TRUE THEN v_ok := false; END IF;

  PERFORM public.restore_stock_on_cancel_impl(
    (SELECT o FROM public.orders o WHERE id = v_order1),
    (SELECT o FROM public.orders o WHERE id = v_order1)
  );
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','double_restore_idempotent','stock',v_stock,'expect',5,'ok',v_stock=5));
  IF v_stock <> 5 THEN v_ok := false; END IF;

  INSERT INTO public.orders (buyer_id, seller_id, status, payment_status, total_amount, payment_type)
  VALUES (v_buyer, v_seller, 'payment_pending', 'pending', 10, 'online') RETURNING id INTO v_order2;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, stock_restored)
  VALUES (v_order2, v_product, 'hold_verify_item2', 5, 10, false);
  UPDATE public.products SET stock_quantity = stock_quantity - 5 WHERE id = v_product AND stock_quantity >= 5;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','second_sale_after_cancel','stock',v_stock,'expect',0,'ok',v_stock=0));
  IF v_stock <> 0 THEN v_ok := false; END IF;

  UPDATE public.products SET stock_quantity = 4 WHERE id = v_product;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_order2;
  DELETE FROM public.order_items WHERE order_id = v_order2;
  DELETE FROM public.orders WHERE id = v_order2;

  INSERT INTO public.orders (buyer_id, seller_id, status, payment_status, total_amount, payment_type)
  VALUES (v_buyer, v_seller, 'placed', 'paid', 10, 'online') RETURNING id INTO v_order2;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, stock_restored)
  VALUES (v_order2, v_product, 'hold_verify_reject', 1, 10, false);
  UPDATE public.products SET stock_quantity = stock_quantity - 1 WHERE id = v_product;
  PERFORM set_config('app.acting_as', 'system', true);
  UPDATE public.orders SET status = 'rejected', updated_at = now() WHERE id = v_order2;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  SELECT stock_restored INTO v_restored FROM public.order_items WHERE order_id = v_order2 LIMIT 1;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','reject_restores','stock',v_stock,'expect',4,'stock_restored',v_restored,'ok',v_stock=4 AND v_restored IS TRUE));
  IF v_stock <> 4 OR v_restored IS NOT TRUE THEN v_ok := false; END IF;

  UPDATE public.products SET stock_quantity = 3 WHERE id = v_product;
  UPDATE public.orders SET status = 'cancelled', payment_status = 'pending', razorpay_payment_id = null WHERE id = v_order1;
  UPDATE public.order_items SET stock_restored = true WHERE order_id = v_order1;
  v_hold := public.rehold_stock_for_order(v_order1);
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product;
  SELECT stock_restored INTO v_restored FROM public.order_items WHERE order_id = v_order1 LIMIT 1;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','resurrect_rehold','hold',v_hold,'stock',v_stock,'expect',1,'stock_restored',v_restored,'ok',COALESCE(v_hold->>'success','false')='true' AND v_stock=1 AND v_restored IS FALSE));
  IF COALESCE(v_hold->>'success','false') <> 'true' OR v_stock <> 1 OR v_restored IS NOT FALSE THEN v_ok := false; END IF;

  UPDATE public.products SET stock_quantity = 0 WHERE id = v_product;
  UPDATE public.order_items SET stock_restored = true WHERE order_id = v_order1;
  v_hold := public.rehold_stock_for_order(v_order1);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('step','resurrect_insufficient_fails','hold',v_hold,'ok',COALESCE(v_hold->>'success','true')='false'));
  IF COALESCE(v_hold->>'success','true') <> 'false' THEN v_ok := false; END IF;

  IF NOT p_commit THEN
    DELETE FROM public.order_items WHERE order_id IN (v_order1, v_order2);
    DELETE FROM public.orders WHERE id IN (v_order1, v_order2);
    DELETE FROM public.products WHERE id = v_product;
  END IF;

  RETURN jsonb_build_object('success', v_ok, 'model', 'cmvo_hard_hold_with_idempotent_release', 'checks', v_checks);
END;
$fn$;
