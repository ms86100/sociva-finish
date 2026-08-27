-- P0: create_multi_vendor_orders was decrementing stock BEFORE returning
-- success:false (out_of_range / closed / payment / credit). Because those
-- paths RETURN json (they do not RAISE), the transaction commits and stock
-- is permanently reduced even though no order was created.
--
-- Fix: remove the premature stock loop; decrement only from order_items of
-- successfully created orders, after failure early-returns.

DO $$
DECLARE
  src text;
  old_stock text;
  new_stock text;
  old_cart text;
  new_cart text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_multi_vendor_orders'
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  src := replace(src, E'\r\n', E'\n');

  old_stock := $old$
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _client_qty := (_item->>'quantity')::int;

      select stock_quantity is not null into _tracks_stock
      from public.products where id = _product_id;

      if coalesce(_tracks_stock, false) then
        update public.products
        set stock_quantity = stock_quantity - _client_qty,
            is_available = case
              when stock_quantity - _client_qty <= 0 then false
              else is_available
            end
        where id = _product_id
          and stock_quantity is not null
          and stock_quantity >= _client_qty;

        get diagnostics _stock_rows = row_count;
        if _stock_rows = 0 then
          raise exception 'insufficient_stock for product %', _product_id
            using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end loop;
$old$;

  new_stock := $new$
  -- Stock decrement deferred until orders are confirmed successful.
$new$;

  IF position(old_stock in src) = 0 THEN
    RAISE EXCEPTION 'create_multi_vendor_orders premature stock block not found — inspect live definition';
  END IF;
  src := replace(src, old_stock, new_stock);

  old_cart := $old$
  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;
$old$;

  new_cart := $new$
  -- Decrement stock only for products on successfully created orders.
  if coalesce(array_length(_order_ids, 1), 0) > 0 then
    for _product_id, _client_qty in
      select oi.product_id, sum(oi.quantity)::int
      from public.order_items oi
      where oi.order_id = any (_order_ids)
      group by oi.product_id
    loop
      select stock_quantity is not null into _tracks_stock
      from public.products where id = _product_id;

      if coalesce(_tracks_stock, false) then
        update public.products
        set stock_quantity = stock_quantity - _client_qty,
            is_available = case
              when stock_quantity - _client_qty <= 0 then false
              else is_available
            end
        where id = _product_id
          and stock_quantity is not null
          and stock_quantity >= _client_qty;

        get diagnostics _stock_rows = row_count;
        if _stock_rows = 0 then
          raise exception 'insufficient_stock for product %', _product_id
            using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;
$new$;

  IF position(old_cart in src) = 0 THEN
    RAISE EXCEPTION 'create_multi_vendor_orders cart-clear block not found — inspect live definition';
  END IF;
  src := replace(src, old_cart, new_cart);

  EXECUTE src;
END;
$$;

-- Ops: Biryani zone delivery radius was 1km — most checkouts fail as out_of_range.
UPDATE public.seller_profiles
SET delivery_radius_km = 5
WHERE id = '625f6f6e-97b9-490f-ad7f-666de0d96527'
  AND coalesce(delivery_radius_km, 0) < 5;
