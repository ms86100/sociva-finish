-- Product variants phase 1 - database gate tests.
--
-- Run on a database copy (Supabase branch), never on production.
-- Every check runs inside one sub-transaction that is rolled back at the end,
-- so fixtures, orders, notifications and stock changes are all discarded.
-- Fixtures are discovered at run time; nothing is tied to a specific seller.
--
-- Usage: execute this whole file; the final SELECT returns one JSON row per check.

create or replace function pg_temp.product_variants_gate()
returns jsonb
language plpgsql
as $gate$
declare
  r jsonb := '[]'::jsonb;
  step text := 'setup';
  v_seller uuid; v_seller_user uuid; v_seller_threshold int; v_category text; v_action text;
  v_buyer uuid; v_buyer_society uuid; v_other_user uuid;
  p_legacy uuid; p_var uuid; p_other uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v_other uuid;
  n int; n2 int; s int; s2 int; txt text; j json; jb jsonb; ok boolean;
  o1 uuid; o_online uuid; o_retry json;
  v_old public.orders; v_new public.orders;
  cart_before int;
  b0 int;
begin
  begin
    -- Fixtures --------------------------------------------------------------
    select sp.id, sp.user_id, sp.low_stock_alert_threshold, p.category, coalesce(p.action_type, 'add_to_cart')
      into v_seller, v_seller_user, v_seller_threshold, v_category, v_action
    from public.seller_profiles sp
    join public.products p on p.seller_id = sp.id
    join public.category_config cc on cc.category = p.category
    where sp.verification_status = 'approved'
      and sp.society_id is not null
      and p.approval_status = 'approved' and p.is_available
      and cc.supports_cart is true
      and coalesce(p.action_type, 'add_to_cart') = 'add_to_cart'
      and public.seller_has_resolvable_location(sp.id)
      and public.seller_is_eligible_for_discovery(sp.id)
      and public.seller_credit_activation_satisfied(sp.id)
      and coalesce((public.seller_credit_can_accept(sp.id, 'ORDER_COMPLETED')->>'ok')::boolean, false)
    order by sp.created_at
    limit 1;
    if v_seller is null then
      return jsonb_build_array(jsonb_build_object('id', 'setup', 'ok', false, 'detail', 'no eligible cart seller on this database'));
    end if;

    update public.seller_profiles
    set availability_start = null, availability_end = null, operating_days = null,
        manual_override = null, manual_override_until = null, is_available = true,
        pickup_payment_config = coalesce(pickup_payment_config, '{}'::jsonb) || '{"accepts_cod": true, "accepts_online": true}'::jsonb
    where id = v_seller;

    select pr.id, pr.society_id into v_buyer, v_buyer_society
    from public.profiles pr
    join auth.users u on u.id = pr.id
    where pr.society_id is not null
      and pr.id <> v_seller_user
      and not exists (select 1 from public.cart_items c where c.user_id = pr.id)
    order by pr.created_at
    limit 1;
    select pr.id into v_other_user
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.id not in (v_buyer, v_seller_user)
    limit 1;

    select count(*) into cart_before from public.cart_items;

    insert into public.products (seller_id, name, price, category, action_type, stock_quantity, is_available, approval_status)
    values (v_seller, '_gate_legacy_' || gen_random_uuid(), 100, v_category, v_action, 10, true, 'approved')
    returning id into p_legacy;
    insert into public.products (seller_id, name, price, category, action_type, stock_quantity, is_available, approval_status)
    values (v_seller, '_gate_variant_' || gen_random_uuid(), 999, v_category, v_action, 7, true, 'approved')
    returning id into p_var;
    insert into public.products (seller_id, name, price, category, action_type, stock_quantity, is_available, approval_status)
    values (v_seller, '_gate_other_' || gen_random_uuid(), 50, v_category, v_action, null, true, 'approved')
    returning id into p_other;

    -- Sizes switch -----------------------------------------------------------------
    step := 'switch';
    insert into public.system_settings (key, value) values ('product_sizes_enabled', to_jsonb('false'::text))
    on conflict (key) do update set value = excluded.value;
    begin
      insert into public.product_variants (product_id, label, price) values (p_var, '250 g', 185);
      r := r || jsonb_build_array(jsonb_build_object('id', 'SW-01 new size rejected while sizes are switched off', 'ok', false, 'detail', 'insert succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'SW-01 new size rejected while sizes are switched off', 'ok', sqlerrm = 'SIZES_DISABLED', 'detail', sqlerrm));
    end;
    update public.system_settings set value = to_jsonb('true'::text) where key = 'product_sizes_enabled';

    -- Variant schema and parent sync ------------------------------------------
    step := 'variants';
    insert into public.product_variants (product_id, label, price, stock_quantity, low_stock_threshold, sort_order)
    values (p_var, '250 g', 185, 10, 3, 0) returning id into v1;
    insert into public.product_variants (product_id, label, price, stock_quantity, sort_order)
    values (p_var, '500 g', 350, null, 1) returning id into v2;
    insert into public.product_variants (product_id, label, price, stock_quantity, sort_order)
    values (p_var, '1 kg', 600, 2, 2) returning id into v3;
    insert into public.product_variants (product_id, label, price, stock_quantity, sort_order)
    values (p_var, '2 kg', 1100, null, 3) returning id into v4;
    insert into public.product_variants (product_id, label, price)
    values (p_other, 'Single', 50) returning id into v_other;

    select to_jsonb(p) into jb from public.products p where p.id = p_var;
    r := r || jsonb_build_array(jsonb_build_object('id', 'V-01 parent price = lowest active variant, parent stock cleared',
      'ok', (jb->>'price')::numeric = 185 and jb->'stock_quantity' = 'null'::jsonb, 'detail', jsonb_build_object('price', jb->'price', 'stock', jb->'stock_quantity')));

    begin
      insert into public.product_variants (product_id, label, price) values (p_var, ' 250 G ', 190);
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-02 duplicate live label rejected', 'ok', false, 'detail', 'insert succeeded'));
    exception when unique_violation then
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-02 duplicate live label rejected', 'ok', true, 'detail', sqlerrm));
    end;

    begin
      insert into public.product_variants (product_id, label, price) values (p_var, 'Free', 0);
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-03 zero price rejected', 'ok', false, 'detail', 'insert succeeded'));
    exception when check_violation then
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-03 zero price rejected', 'ok', true, 'detail', sqlerrm));
    end;

    step := 'variant_action';
    select atm.action_type into txt from public.action_type_workflow_map atm where atm.checkout_mode <> 'cart' order by atm.action_type limit 1;
    begin
      insert into public.product_variants (product_id, label, price)
      select p.id, '_gate_size', 10
      from public.products p
      join public.action_type_workflow_map atm on atm.action_type = p.action_type
      where atm.checkout_mode <> 'cart'
      limit 1;
      get diagnostics n = row_count;
      r := r || jsonb_build_array(jsonb_build_object('id', 'A-01 size on a booking, enquiry or contact product rejected', 'ok', false,
        'detail', case when n = 0 then 'no non-cart product on this database' else 'insert succeeded' end));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'A-01 size on a booking, enquiry or contact product rejected', 'ok', sqlerrm like 'VARIANTS_NOT_SUPPORTED%', 'detail', sqlerrm));
    end;

    begin
      update public.products set action_type = txt where id = p_var;
      r := r || jsonb_build_array(jsonb_build_object('id', 'A-02 sized product cannot switch to a non-cart action', 'ok', false, 'detail', 'update succeeded to ' || txt));
    exception when others then
      -- The existing store checkout-mode rule may fire first; either guard blocking it is a pass.
      r := r || jsonb_build_array(jsonb_build_object('id', 'A-02 sized product cannot switch to a non-cart action', 'ok', sqlerrm like 'VARIANTS_NOT_SUPPORTED%' or sqlerrm like '%Checkout modes must match%', 'detail', sqlerrm));
    end;

    r := r || jsonb_build_array(jsonb_build_object('id', 'A-04 size rule reads cart actions from action_type_workflow_map',
      'ok', public.product_action_allows_variants(null)
        and not public.product_action_allows_variants(txt)
        and not exists (select 1 from public.action_type_workflow_map atm where (atm.checkout_mode = 'cart') <> public.product_action_allows_variants(atm.action_type)),
      'detail', (select jsonb_object_agg(atm.action_type, public.product_action_allows_variants(atm.action_type)) from public.action_type_workflow_map atm)));

    begin
      update public.products set action_type = txt where id = p_legacy;
      r := r || jsonb_build_array(jsonb_build_object('id', 'A-03 product without sizes can still change action', 'ok', true, 'detail', txt));
      raise exception 'A03_UNDO';
    exception when others then
      if sqlerrm <> 'A03_UNDO' then
        r := r || jsonb_build_array(jsonb_build_object('id', 'A-03 product without sizes can still change action', 'ok', sqlerrm not like 'VARIANTS_NOT_SUPPORTED%', 'detail', sqlerrm));
      end if;
    end;

    -- Variant RLS ---------------------------------------------------------------
    step := 'variant_rls';
    perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    begin
      execute 'set local role authenticated';
      insert into public.product_variants (product_id, label, price) values (p_var, 'Hack', 1);
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-04 non-owner cannot add a size', 'ok', false, 'detail', 'insert succeeded'));
    exception when insufficient_privilege then
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-04 non-owner cannot add a size', 'ok', true, 'detail', sqlerrm));
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_seller_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_seller_user::text, true);
    begin
      execute 'set local role authenticated';
      update public.product_variants set sort_order = 0 where id = v4;
      get diagnostics n = row_count;
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-05 owning seller can edit a size', 'ok', n = 1, 'detail', n));
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'V-05 owning seller can edit a size', 'ok', false, 'detail', sqlerrm));
    end;

    -- Cart RLS and uniqueness --------------------------------------------------------
    -- Sizes are switched off again from here: existing sizes must keep selling.
    step := 'cart';
    update public.system_settings set value = to_jsonb('false'::text) where key = 'product_sizes_enabled';
    perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    execute 'set local role authenticated';

    insert into public.cart_items (user_id, product_id, quantity) values (v_buyer, p_legacy, 1);
    r := r || jsonb_build_array(jsonb_build_object('id', 'C-01 legacy product line inserts with variant_id null', 'ok', true));

    begin
      insert into public.cart_items (user_id, product_id, quantity) values (v_buyer, p_legacy, 1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-02 second legacy line for same product rejected (NULLS NOT DISTINCT)', 'ok', false, 'detail', 'insert succeeded'));
    exception when unique_violation then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-02 second legacy line for same product rejected (NULLS NOT DISTINCT)', 'ok', true, 'detail', sqlerrm));
    end;

    begin
      insert into public.cart_items (user_id, product_id, quantity) values (v_buyer, p_var, 1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-03 sized product without a size rejected', 'ok', false, 'detail', 'insert succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-03 sized product without a size rejected', 'ok', sqlerrm like '%VARIANT_REQUIRED%', 'detail', sqlerrm));
    end;

    insert into public.cart_items (user_id, product_id, variant_id, quantity) values (v_buyer, p_var, v1, 3);
    insert into public.cart_items (user_id, product_id, variant_id, quantity) values (v_buyer, p_var, v2, 1);
    select count(*) into n from public.cart_items where user_id = v_buyer and product_id = p_var;
    r := r || jsonb_build_array(jsonb_build_object('id', 'C-04 two sizes of one product stay separate lines', 'ok', n = 2, 'detail', n));

    begin
      insert into public.cart_items (user_id, product_id, variant_id, quantity) values (v_buyer, p_var, v1, 1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-05 duplicate size line rejected', 'ok', false, 'detail', 'insert succeeded'));
    exception when unique_violation then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-05 duplicate size line rejected', 'ok', true, 'detail', sqlerrm));
    end;

    begin
      insert into public.cart_items (user_id, product_id, variant_id, quantity) values (v_buyer, p_legacy, v1, 1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-06 size from another product rejected', 'ok', false, 'detail', 'insert succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-06 size from another product rejected', 'ok', sqlerrm like '%VARIANT_NOT_AVAILABLE%', 'detail', sqlerrm));
    end;

    begin
      update public.cart_items set quantity = 11 where user_id = v_buyer and variant_id = v1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-07 cart quantity capped by size stock', 'ok', false, 'detail', 'update succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-07 cart quantity capped by size stock', 'ok', sqlerrm like '%exceeds available stock (10)%', 'detail', sqlerrm));
    end;

    begin
      update public.cart_items set quantity = 11 where user_id = v_buyer and product_id = p_legacy;
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-08 legacy cart quantity still capped by product stock', 'ok', false, 'detail', 'update succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-08 legacy cart quantity still capped by product stock', 'ok', sqlerrm like '%exceeds available stock (10)%', 'detail', sqlerrm));
    end;

    begin
      insert into public.cart_items (user_id, product_id, quantity) values (v_other_user, p_legacy, 1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-09 cart INSERT RLS blocks another user_id', 'ok', false, 'detail', 'insert succeeded'));
    exception when insufficient_privilege then
      r := r || jsonb_build_array(jsonb_build_object('id', 'C-09 cart INSERT RLS blocks another user_id', 'ok', true, 'detail', sqlerrm));
    end;

    execute 'reset role';

    -- Checkout ---------------------------------------------------------------------------
    step := 'checkout';
    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_legacy, 'quantity', 2, 'unit_price', 100, 'product_name', 'Legacy'),
        json_build_object('product_id', p_var, 'variant_id', v1, 'quantity', 3, 'unit_price', 185),
        json_build_object('product_id', p_var, 'variant_id', v2, 'quantity', 1, 'unit_price', 350)
      ))),
      _fulfillment_type => 'self_pickup',
      _payment_method => 'cod',
      _payment_status => 'pending',
      _coupon_discount => 55.5,
      _idempotency_key => 'gate-' || gen_random_uuid()
    );
    o1 := (j->'order_ids'->>0)::uuid;
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-01 mixed legacy + two sizes checkout succeeds', 'ok', (j->>'success')::boolean, 'detail', j));
    r := r || jsonb_build_array(jsonb_build_object('id', 'SW-02 with sizes switched off, existing sizes still add to cart and check out',
      'ok', (j->>'success')::boolean
        and (select ss.value #>> '{}' from public.system_settings ss where ss.key = 'product_sizes_enabled') = 'false',
      'detail', j->'order_ids'));

    if o1 is not null then
      select jsonb_agg(jsonb_build_object('product', oi.product_id = p_var, 'variant_label', oi.variant_label, 'variant_id', oi.variant_id is not null, 'qty', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal) order by oi.unit_price)
        into jb from public.order_items oi where oi.order_id = o1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'K-02 order lines snapshot size label and server price',
        'ok', jsonb_array_length(jb) = 3
          and exists (select 1 from public.order_items oi where oi.order_id = o1 and oi.variant_id = v1 and oi.variant_label = '250 g' and oi.unit_price = 185 and oi.subtotal = 555
            and oi.product_name = (select p.name from public.products p where p.id = p_var) || ' (250 g)')
          and exists (select 1 from public.order_items oi where oi.order_id = o1 and oi.product_id = p_legacy and oi.product_name = 'Legacy')
          and exists (select 1 from public.order_items oi where oi.order_id = o1 and oi.variant_id = v2 and oi.variant_label = '500 g' and oi.unit_price = 350)
          and exists (select 1 from public.order_items oi where oi.order_id = o1 and oi.product_id = p_legacy and oi.variant_id is null and oi.variant_label is null),
        'detail', jb));

      select to_jsonb(o) into jb from public.orders o where o.id = o1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'K-03 order total = items + packaging + delivery - coupon',
        'ok', (jb->>'total_amount')::numeric = 200 + 555 + 350 + coalesce((jb->>'packaging_fee')::numeric, 0) + coalesce((jb->>'delivery_fee')::numeric, 0) - 55.5
          and (jb->>'coupon_discount')::numeric = 55.5,
        'detail', jsonb_build_object('total', jb->'total_amount', 'packaging', jb->'packaging_fee', 'delivery', jb->'delivery_fee', 'coupon', jb->'coupon_discount')));

      select stock_quantity into s from public.products where id = p_legacy;
      select stock_quantity into s2 from public.product_variants where id = v1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'K-04 stock decremented on the right row (legacy product 10->8, size 10->7, untracked size unchanged)',
        'ok', s = 8 and s2 = 7 and (select stock_quantity from public.product_variants where id = v2) is null
          and (select stock_quantity from public.products where id = p_var) is null,
        'detail', jsonb_build_object('legacy', s, 'size_250g', s2)));

      select count(*) into n from public.cart_items where user_id = v_buyer;
      r := r || jsonb_build_array(jsonb_build_object('id', 'K-05 buyer cart cleared after checkout', 'ok', n = 0, 'detail', n));

      -- Payment retry with the same key must not create orders or move stock again
      select o.idempotency_key into txt from public.orders o where o.id = o1;
      o_retry := public.create_multi_vendor_orders(
        _buyer_id => v_buyer,
        _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
          json_build_object('product_id', p_var, 'variant_id', v1, 'quantity', 3, 'unit_price', 185)))),
        _fulfillment_type => 'self_pickup', _payment_method => 'cod', _payment_status => 'pending',
        _idempotency_key => split_part(txt, ':', 1)
      );
      r := r || jsonb_build_array(jsonb_build_object('id', 'K-06 retry with same idempotency key is deduplicated, stock unchanged',
        'ok', (o_retry->>'deduplicated')::boolean is true and (o_retry->'order_ids'->>0)::uuid = o1
          and (select stock_quantity from public.product_variants where id = v1) = 7
          and (select stock_quantity from public.products where id = p_legacy) = 8,
        'detail', o_retry));
    end if;

    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_var, 'variant_id', v1, 'quantity', 1, 'unit_price', 180)))),
      _fulfillment_type => 'self_pickup', _payment_method => 'cod');
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-07 stale size price rejected (price_changed)', 'ok', j->>'error' = 'price_changed', 'detail', j));

    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_var, 'quantity', 1, 'unit_price', 185)))),
      _fulfillment_type => 'self_pickup', _payment_method => 'cod');
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-08 sized product without size rejected (old app path)', 'ok', j->>'error' = 'unavailable_items' and j::text like '%choose a size%', 'detail', j));

    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_var, 'variant_id', v1, 'quantity', 8, 'unit_price', 185)))),
      _fulfillment_type => 'self_pickup', _payment_method => 'cod');
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-09 size stock enforced at checkout', 'ok', j->>'error' = 'insufficient_stock', 'detail', j));

    update public.product_variants set is_active = false where id = v3;
    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_var, 'variant_id', v3, 'quantity', 1, 'unit_price', 600)))),
      _fulfillment_type => 'self_pickup', _payment_method => 'cod');
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-10 inactive size rejected', 'ok', j->>'error' = 'unavailable_items' and j::text like '%size no longer available%', 'detail', j));

    j := public.create_multi_vendor_orders(
      _buyer_id => v_buyer,
      _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
        json_build_object('product_id', p_legacy, 'quantity', 1, 'unit_price', 99)))),
      _fulfillment_type => 'self_pickup', _payment_method => 'cod');
    r := r || jsonb_build_array(jsonb_build_object('id', 'K-11 legacy stale price still rejected', 'ok', j->>'error' = 'price_changed', 'detail', j));

    -- Cancel restore and rehold ----------------------------------------------------------
    step := 'cancel';
    if o1 is not null then
      perform set_config('app.acting_as', 'system', true);
      update public.orders set status = 'cancelled', updated_at = now() where id = o1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-01 cancel restores legacy and size stock',
        'ok', (select stock_quantity from public.products where id = p_legacy) = 10
          and (select stock_quantity from public.product_variants where id = v1) = 10
          and (select stock_quantity from public.product_variants where id = v2) is null
          and not exists (select 1 from public.order_items where order_id = o1 and stock_restored is not true),
        'detail', jsonb_build_object('legacy', (select stock_quantity from public.products where id = p_legacy), 'size_250g', (select stock_quantity from public.product_variants where id = v1))));

      select * into v_new from public.orders where id = o1;
      v_old := v_new; v_old.status := 'placed';
      perform public.restore_stock_on_cancel_impl(v_old, v_new);
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-02 second restore is a no-op (stock_restored flag)',
        'ok', (select stock_quantity from public.products where id = p_legacy) = 10
          and (select stock_quantity from public.product_variants where id = v1) = 10,
        'detail', jsonb_build_object('legacy', (select stock_quantity from public.products where id = p_legacy), 'size_250g', (select stock_quantity from public.product_variants where id = v1))));

      jb := public.rehold_stock_for_order(o1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-03 rehold takes stock back for legacy and size lines',
        'ok', (jb->>'success')::boolean and (jb->>'items_reheld')::int = 2
          and (select stock_quantity from public.products where id = p_legacy) = 8
          and (select stock_quantity from public.product_variants where id = v1) = 7
          and not exists (select 1 from public.order_items where order_id = o1 and stock_restored),
        'detail', jb));

      jb := public.rehold_stock_for_order(o1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-04 second rehold is a no-op',
        'ok', (jb->>'items_reheld')::int = 0 and (select stock_quantity from public.product_variants where id = v1) = 7,
        'detail', jb));

      perform public.restore_stock_on_cancel_impl(v_old, v_new);
      update public.product_variants set stock_quantity = 1 where id = v1;
      jb := public.rehold_stock_for_order(o1);
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-05 rehold reports insufficient size stock',
        'ok', jb->>'error' = 'insufficient_stock' and (jb->>'variant_id')::uuid = v1,
        'detail', jb));
      update public.product_variants set stock_quantity = 10 where id = v1;
    end if;

    -- Online payment: auto-cancel then late capture resurrects and re-holds the size
    step := 'online';
    begin
      j := public.create_multi_vendor_orders(
        _buyer_id => v_buyer,
        _seller_groups => json_build_array(json_build_object('seller_id', v_seller, 'items', json_build_array(
          json_build_object('product_id', p_var, 'variant_id', v1, 'quantity', 2, 'unit_price', 185)))),
        _fulfillment_type => 'self_pickup', _payment_method => 'online', _payment_status => 'pending',
        _idempotency_key => 'gate-online-' || gen_random_uuid());
      o_online := (j->'order_ids'->>0)::uuid;
      s := (select stock_quantity from public.product_variants where id = v1);
      perform set_config('app.acting_as', 'system', true);
      update public.orders set status = 'cancelled', updated_at = now() where id = o_online;
      s2 := (select stock_quantity from public.product_variants where id = v1);
      jb := public.resurrect_cancelled_order_after_payment(o_online, 'pay_gate_' || substr(md5(random()::text), 1, 10));
      r := r || jsonb_build_array(jsonb_build_object('id', 'P-01 online size order: hold 10->8, cancel restores ->10, late capture re-holds ->8 and marks paid',
        'ok', (j->>'success')::boolean and s = 8 and s2 = 10
          and (select stock_quantity from public.product_variants where id = v1) = 8
          and (select status::text || '/' || payment_status from public.orders where id = o_online) = 'placed/paid'
          and (jb->>'success')::boolean,
        'detail', jsonb_build_object('checkout', j, 'after_hold', s, 'after_cancel', s2, 'confirm', jb)));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'P-01 online size order cancel and late capture', 'ok', false, 'detail', sqlerrm));
    end;

    -- Low-stock monitoring ------------------------------------------------------------------
    step := 'alerts';
    update public.product_variants set stock_quantity = 8 where id = v1;
    select count(*) into b0 from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' in (v1::text, v2::text);
    update public.product_variants set stock_quantity = 7 where id = v1;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' = v1::text;
    update public.product_variants set stock_quantity = 3 where id = v1;
    select count(*) into n2 from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' = v1::text;
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-01 size crossing its threshold (7->3, threshold 3) sends one low_stock alert; 8->7 sends none',
      'ok', n = b0 and n2 = b0 + 1
        and exists (select 1 from public.notification_queue where user_id = v_seller_user and type = 'low_stock' and payload->>'variant_id' = v1::text and (payload->>'stock_quantity')::int = 3),
      'detail', (select jsonb_agg(jsonb_build_object('title', title, 'body', body, 'payload', payload)) from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' = v1::text and (payload->>'stock_quantity')::int = 3)));

    update public.product_variants set stock_quantity = 2 where id = v1;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' = v1::text;
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-02 further drop below threshold does not repeat the alert', 'ok', n = b0 + 1, 'detail', n - b0));

    update public.product_variants set stock_quantity = 0 where id = v1;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and type = 'out_of_stock' and payload->>'variant_id' = v1::text;
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-03 size reaching 0 sends out_of_stock; parent and other sizes stay live',
      'ok', n = 1 and (select is_available from public.products where id = p_var)
        and (select is_active from public.product_variants where id = v2),
      'detail', (select body from public.notification_queue where user_id = v_seller_user and type = 'out_of_stock' and payload->>'variant_id' = v1::text limit 1)));

    update public.product_variants set stock_quantity = 5 where id = v1;
    update public.product_variants set price = 351 where id = v2;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and payload->>'variant_id' in (v1::text, v2::text);
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-04 restock and untracked size changes do not alert', 'ok', n = b0 + 2, 'detail', n - b0));

    update public.product_variants set stock_quantity = 20, low_stock_threshold = null where id = v1;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and type = 'low_stock' and payload->>'variant_id' = v1::text;
    update public.product_variants set stock_quantity = coalesce(v_seller_threshold, 5) where id = v1;
    select count(*) into n2 from public.notification_queue where user_id = v_seller_user and type = 'low_stock' and payload->>'variant_id' = v1::text and (payload->>'threshold')::int = coalesce(v_seller_threshold, 5);
    select count(*) into s from public.notification_queue where user_id = v_seller_user and type = 'low_stock' and payload->>'variant_id' = v1::text;
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-05 size without its own threshold uses the seller threshold (else 5)', 'ok', s = n + 1 and n2 >= 1, 'detail', jsonb_build_object('threshold', coalesce(v_seller_threshold, 5), 'before', n, 'after', s)));

    update public.products set stock_quantity = 20 where id = p_legacy;
    update public.products set stock_quantity = coalesce(v_seller_threshold, 5) where id = p_legacy;
    select count(*) into n from public.notification_queue where user_id = v_seller_user and type = 'low_stock' and payload->>'product_id' = p_legacy::text;
    r := r || jsonb_build_array(jsonb_build_object('id', 'L-06 legacy product low-stock alert unchanged', 'ok', n = 1, 'detail', n));

    -- Size lifecycle ---------------------------------------------------------------------------
    step := 'lifecycle';
    begin
      delete from public.product_variants where id = v1;
      r := r || jsonb_build_array(jsonb_build_object('id', 'D-01 size used by an order cannot be deleted', 'ok', false, 'detail', 'delete succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'D-01 size used by an order cannot be deleted', 'ok', sqlerrm like 'VARIANT_IN_USE%', 'detail', sqlerrm));
    end;

    update public.product_variants set is_active = false where id = v1;
    r := r || jsonb_build_array(jsonb_build_object('id', 'D-02 deactivating a size recomputes parent price from live sizes',
      'ok', (select price from public.products where id = p_var) = 351, 'detail', (select price from public.products where id = p_var)));

    delete from public.product_variants where id = v4;
    r := r || jsonb_build_array(jsonb_build_object('id', 'D-03 unused size can be deleted', 'ok', not exists (select 1 from public.product_variants where id = v4)));

    update public.product_variants set label = '250 g jar' where id = v1;
    r := r || jsonb_build_array(jsonb_build_object('id', 'D-04 renaming a size does not rewrite past orders',
      'ok', exists (select 1 from public.order_items where order_id = o1 and variant_id = v1 and variant_label = '250 g'), 'detail', null));

    delete from public.products where id = p_var;
    r := r || jsonb_build_array(jsonb_build_object('id', 'D-05 deleting the product cascades sizes; order history keeps name, size label and price',
      'ok', not exists (select 1 from public.product_variants where product_id = p_var)
        and exists (select 1 from public.order_items where order_id = o1 and variant_id is null and product_id is null and variant_label = '250 g' and unit_price = 185),
      'detail', (select jsonb_agg(jsonb_build_object('name', product_name, 'label', variant_label, 'price', unit_price)) from public.order_items where order_id = o1)));

    -- Existing rows untouched ---------------------------------------------------------------------
    step := 'existing';
    select count(*) into n from public.cart_items where user_id <> v_buyer;
    r := r || jsonb_build_array(jsonb_build_object('id', 'E-01 existing cart rows of other buyers untouched by the run', 'ok', n = cart_before, 'detail', jsonb_build_object('before', cart_before, 'after', n)));

    raise exception 'GATE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'GATE_ROLLBACK' then
      r := r || jsonb_build_array(jsonb_build_object('id', 'harness', 'ok', false, 'detail', 'step ' || step || ': ' || sqlerrm));
    end if;
  end;
  begin execute 'reset role'; exception when others then null; end;
  return r;
end;
$gate$;

select e->>'id' as check_id, (e->>'ok')::boolean as ok, e->'detail' as detail
from jsonb_array_elements(pg_temp.product_variants_gate()) e;
