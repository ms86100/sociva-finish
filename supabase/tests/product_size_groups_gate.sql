-- Product size groups - database gate tests.
--
-- Run on a database copy (Supabase branch), never on production.
-- Requires 20261011180000_product_variants_phase1, 20261011190000_product_sizes_switch
-- and 20261011200000_product_size_groups.
-- Every check runs inside one sub-transaction that is rolled back at the end,
-- so fixtures, groups, cart lines and favourites are all discarded.
-- Fixtures are discovered at run time; nothing is tied to a specific seller.
--
-- Usage: execute this whole file; the final SELECT returns one row per check.

create or replace function pg_temp.product_size_groups_gate()
returns jsonb
language plpgsql
as $gate$
declare
  r jsonb := '[]'::jsonb;
  step text := 'setup';
  tag text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  base text;
  v_seller uuid; v_seller_user uuid; v_category text; v_action text;
  v_other_seller uuid;
  v_buyer uuid; v_fan uuid;
  p250 uuid; p500 uuid; p1k uuid; p_solo uuid; p_foreign uuid;
  sizes jsonb;
  plan jsonb; res jsonb; jb jsonb;
  batch uuid; batch2 uuid;
  v250 uuid; v500 uuid; v1k uuid;
  n int; txt text; ok boolean;
  cart_before int;
begin
  begin
    -- Fixtures ----------------------------------------------------------------------
    select sp.id, sp.user_id, p.category, coalesce(p.action_type, 'add_to_cart')
      into v_seller, v_seller_user, v_category, v_action
    from public.seller_profiles sp
    join public.products p on p.seller_id = sp.id
    join public.category_config cc on cc.category = p.category
    where sp.verification_status = 'approved'
      and p.approval_status = 'approved'
      and cc.supports_cart is true
      and coalesce(p.action_type, 'add_to_cart') = 'add_to_cart'
    order by sp.created_at
    limit 1;
    if v_seller is null then
      return jsonb_build_array(jsonb_build_object('id', 'setup', 'ok', false, 'detail', 'no approved cart seller on this database'));
    end if;

    select sp.id into v_other_seller
    from public.seller_profiles sp
    where sp.id <> v_seller and sp.user_id <> v_seller_user
    order by sp.created_at
    limit 1;

    select pr.id into v_buyer
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.id <> v_seller_user and not coalesce(public.is_admin(pr.id), false)
    order by pr.created_at
    limit 1;
    select pr.id into v_fan
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.id not in (v_buyer, v_seller_user)
    order by pr.created_at
    limit 1;

    select count(*) into cart_before from public.cart_items where user_id not in (v_buyer, v_fan);

    base := '_gate_sg_' || tag || ' Pickle';
    insert into public.products (seller_id, name, description, serving_size, price, category, action_type, stock_quantity, is_available, approval_status, image_url)
    values (v_seller, base || ' - 250 g', 'Homemade test pickle. 250 g. Tangy.', '250 g', 185, v_category, v_action, null, true, 'approved', 'https://example.invalid/250.webp')
    returning id into p250;
    insert into public.products (seller_id, name, description, serving_size, price, mrp, category, action_type, stock_quantity, is_available, approval_status, image_url)
    values (v_seller, base || ' - 500 g', 'Homemade test pickle. 500 g. Tangy.', '500 g', 350, 400, v_category, v_action, 5, true, 'approved', 'https://example.invalid/500.webp')
    returning id into p500;
    insert into public.products (seller_id, name, description, serving_size, price, category, action_type, stock_quantity, is_available, approval_status, image_url)
    values (v_seller, base || ' - 1 kg', 'Homemade test pickle. 1 kg. Tangy.', '1 kg', 600, v_category, v_action, 3, true, 'approved', 'https://example.invalid/1kg.webp')
    returning id into p1k;
    insert into public.products (seller_id, name, price, category, action_type, is_available, approval_status)
    values (v_seller, '_gate_sg_' || tag || ' Solo', 99, v_category, v_action, true, 'approved')
    returning id into p_solo;
    if v_other_seller is not null then
      insert into public.products (seller_id, name, price, category, action_type, is_available, approval_status)
      values (v_other_seller, base || ' - 2 kg', 1100, v_category, v_action, true, 'approved')
      returning id into p_foreign;
    end if;

    insert into public.cart_items (user_id, product_id, quantity) values (v_buyer, p500, 2);
    insert into public.cart_items (user_id, product_id, quantity) values (v_buyer, p250, 1);
    insert into public.product_favorites (user_id, product_id) values (v_buyer, p1k);
    insert into public.product_favorites (user_id, product_id) values (v_fan, p1k), (v_fan, p250);
    insert into public.stock_watchlist (user_id, product_id) values (v_buyer, p500);

    sizes := jsonb_build_array(
      jsonb_build_object('product_id', p250, 'label', '250 g'),
      jsonb_build_object('product_id', p500, 'label', '500 g'),
      jsonb_build_object('product_id', p1k, 'label', '1 kg'));

    -- Suggestions ---------------------------------------------------------------------
    step := 'suggest';
    select g into jb
    from jsonb_array_elements(public.admin_suggest_size_groups(v_seller)) g
    where g ->> 'name' = base;
    r := r || jsonb_build_array(jsonb_build_object('id', 'S-01 suggest finds the group, cheapest first, size removed from the description',
      'ok', jb is not null
        and (jb ->> 'parent_id')::uuid = p250
        and jsonb_array_length(jb -> 'sizes') = 3
        and jb -> 'sizes' -> 0 ->> 'label' = '250 g'
        and jb -> 'sizes' -> 2 ->> 'label' = '1 kg'
        and jb ->> 'description' = 'Homemade test pickle. Tangy.',
      'detail', jb));
    r := r || jsonb_build_array(jsonb_build_object('id', 'S-02 suggest ignores a listing without a pack size',
      'ok', not exists (
        select 1 from jsonb_array_elements(public.admin_suggest_size_groups(v_seller)) g,
             jsonb_array_elements(g -> 'sizes') s
        where (s ->> 'product_id')::uuid = p_solo)));

    -- Preview -------------------------------------------------------------------------
    step := 'plan';
    select count(*) into n from public.product_variants where product_id in (p250, p500, p1k);
    plan := public.admin_size_group_plan(p250, sizes, base, null);
    r := r || jsonb_build_array(jsonb_build_object('id', 'P-01 preview is clean, counts carts and favourites, writes nothing',
      'ok', (plan ->> 'ok')::boolean
        and jsonb_array_length(plan -> 'blockers') = 0
        and (plan ->> 'cart_lines_to_move')::int = 2
        and (plan ->> 'favorites_to_copy')::int = 2
        and (plan ->> 'watchers_to_copy')::int = 1
        and (plan ->> 'from_price')::numeric = 185
        and (select count(*) from public.product_variants where product_id in (p250, p500, p1k)) = n,
      'detail', plan - 'sizes'));

    plan := public.admin_size_group_plan(p250, jsonb_build_array(sizes -> 0), base, null);
    r := r || jsonb_build_array(jsonb_build_object('id', 'P-02 one size is blocked',
      'ok', not (plan ->> 'ok')::boolean, 'detail', plan -> 'blockers'));

    plan := public.admin_size_group_plan(p250, sizes || jsonb_build_array(jsonb_build_object('product_id', p_solo, 'label', '250 g')), base, null);
    r := r || jsonb_build_array(jsonb_build_object('id', 'P-03 duplicate size label is blocked',
      'ok', not (plan ->> 'ok')::boolean, 'detail', plan -> 'blockers'));

    plan := public.admin_size_group_plan(p_solo, sizes, base, null);
    r := r || jsonb_build_array(jsonb_build_object('id', 'P-04 product not in the size list is blocked',
      'ok', not (plan ->> 'ok')::boolean, 'detail', plan -> 'blockers'));

    if p_foreign is not null then
      plan := public.admin_size_group_plan(p250, sizes || jsonb_build_array(jsonb_build_object('product_id', p_foreign, 'label', '2 kg')), base, null);
      r := r || jsonb_build_array(jsonb_build_object('id', 'P-05 listing from another store is blocked',
        'ok', not (plan ->> 'ok')::boolean, 'detail', plan -> 'blockers'));
    end if;

    -- Admin only ----------------------------------------------------------------------
    step := 'not_admin';
    perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    n := 0;
    begin perform public.admin_suggest_size_groups(v_seller); exception when others then if sqlerrm like 'NOT_ADMIN%' then n := n + 1; end if; end;
    begin perform public.admin_size_group_plan(p250, sizes, base, null); exception when others then if sqlerrm like 'NOT_ADMIN%' then n := n + 1; end if; end;
    begin perform public.admin_apply_size_group(p250, sizes, base, null); exception when others then if sqlerrm like 'NOT_ADMIN%' then n := n + 1; end if; end;
    begin perform public.admin_undo_size_group(gen_random_uuid()); exception when others then if sqlerrm like 'NOT_ADMIN%' then n := n + 1; end if; end;
    r := r || jsonb_build_array(jsonb_build_object('id', 'A-01 a signed-in non-admin is refused by all four functions', 'ok', n = 4, 'detail', n));

    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    select bool_and(not has_function_privilege('anon', f, 'execute')) into ok
    from unnest(array[
      'public.admin_suggest_size_groups(uuid)',
      'public.admin_size_group_plan(uuid, jsonb, text, text)',
      'public.admin_apply_size_group(uuid, jsonb, text, text)',
      'public.admin_undo_size_group(uuid)']) f;
    r := r || jsonb_build_array(jsonb_build_object('id', 'A-02 signed-out callers cannot run the functions', 'ok', ok));

    -- Sizes switch --------------------------------------------------------------------
    step := 'switch';
    insert into public.system_settings (key, value) values ('product_sizes_enabled', to_jsonb('false'::text))
    on conflict (key) do update set value = excluded.value;
    begin
      perform public.admin_apply_size_group(p250, sizes, base, null);
      r := r || jsonb_build_array(jsonb_build_object('id', 'W-01 grouping refused while sizes are switched off', 'ok', false, 'detail', 'apply succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'W-01 grouping refused while sizes are switched off',
        'ok', sqlerrm = 'SIZES_DISABLED'
          and not exists (select 1 from public.product_variants where product_id in (p250, p500, p1k))
          and not exists (select 1 from public.product_size_merges where target_product_id = p250)
          and (select count(*) from public.products where id in (p250, p500, p1k) and is_available) = 3,
        'detail', sqlerrm));
    end;
    update public.system_settings set value = to_jsonb('true'::text) where key = 'product_sizes_enabled';

    -- Apply ---------------------------------------------------------------------------
    step := 'apply';
    res := public.admin_apply_size_group(p250, sizes, base, 'Homemade test pickle. Tangy.');
    batch := (res ->> 'batch_id')::uuid;
    select id into v250 from public.product_variants where product_id = p250 and label = '250 g' and archived_at is null;
    select id into v500 from public.product_variants where product_id = p250 and label = '500 g' and archived_at is null;
    select id into v1k from public.product_variants where product_id = p250 and label = '1 kg' and archived_at is null;

    select jsonb_agg(jsonb_build_object('label', label, 'price', price, 'compare_at', compare_at_price, 'stock', stock_quantity, 'img', image_url) order by sort_order)
      into jb from public.product_variants where product_id = p250 and archived_at is null;
    r := r || jsonb_build_array(jsonb_build_object('id', 'G-01 each listing becomes a size with its own price, MRP, stock and photo',
      'ok', jsonb_array_length(jb) = 3
        and (select price from public.product_variants where id = v250) = 185
        and (select compare_at_price from public.product_variants where id = v500) = 400
        and (select stock_quantity from public.product_variants where id = v500) = 5
        and (select stock_quantity from public.product_variants where id = v1k) = 3
        and (select image_url from public.product_variants where id = v1k) = 'https://example.invalid/1kg.webp',
      'detail', jb));

    select to_jsonb(p) into jb from public.products p where id = p250;
    r := r || jsonb_build_array(jsonb_build_object('id', 'G-02 kept listing is renamed, priced from its cheapest size, still live',
      'ok', jb ->> 'name' = base and (jb ->> 'price')::numeric = 185 and (jb ->> 'is_available')::boolean
        and jb -> 'serving_size' = 'null'::jsonb and jb ->> 'description' = 'Homemade test pickle. Tangy.',
      'detail', jsonb_build_object('name', jb -> 'name', 'price', jb -> 'price', 'available', jb -> 'is_available')));

    r := r || jsonb_build_array(jsonb_build_object('id', 'G-03 other listings are hidden, not deleted',
      'ok', (select count(*) from public.products where id in (p500, p1k) and is_available = false) = 2));

    select jsonb_agg(jsonb_build_object('product', product_id = p250, 'variant', variant_id, 'qty', quantity)) into jb
    from public.cart_items where user_id = v_buyer and product_id in (p250, p500, p1k);
    r := r || jsonb_build_array(jsonb_build_object('id', 'G-04 cart lines move to the product with the matching size',
      'ok', exists (select 1 from public.cart_items where user_id = v_buyer and product_id = p250 and variant_id = v500 and quantity = 2)
        and exists (select 1 from public.cart_items where user_id = v_buyer and product_id = p250 and variant_id = v250 and quantity = 1)
        and not exists (select 1 from public.cart_items where product_id in (p500, p1k)),
      'detail', jb));

    r := r || jsonb_build_array(jsonb_build_object('id', 'G-05 favourites and stock alerts follow to the product without duplicates',
      'ok', exists (select 1 from public.product_favorites where user_id = v_buyer and product_id = p250)
        and (select count(*) from public.product_favorites where user_id = v_fan and product_id = p250) = 1
        and exists (select 1 from public.stock_watchlist where user_id = v_buyer and product_id = p250)));

    r := r || jsonb_build_array(jsonb_build_object('id', 'G-06 every old listing maps to its size',
      'ok', (select count(*) from public.product_size_merges where batch_id = batch and undone_at is null and target_product_id = p250) = 3
        and exists (select 1 from public.product_size_merges where batch_id = batch and source_product_id = p1k and target_variant_id = v1k)));

    begin
      perform public.admin_apply_size_group(p250, sizes, base, null);
      r := r || jsonb_build_array(jsonb_build_object('id', 'G-07 grouping the same listings twice is blocked', 'ok', false, 'detail', 'second apply succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'G-07 grouping the same listings twice is blocked', 'ok', sqlerrm like 'SIZE_GROUP_BLOCKED%', 'detail', sqlerrm));
    end;

    -- Seller and buyer access ----------------------------------------------------------
    step := 'seller_guard';
    perform set_config('request.jwt.claims', json_build_object('sub', v_seller_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_seller_user::text, true);
    begin
      execute 'set local role authenticated';
      update public.products set is_available = true where id = p500;
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-01 seller cannot switch a grouped listing back on', 'ok', false,
        'detail', (select is_available from public.products where id = p500)));
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-01 seller cannot switch a grouped listing back on', 'ok', sqlerrm like 'PRODUCT_MERGED%', 'detail', sqlerrm));
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    begin
      execute 'set local role authenticated';
      select count(*) into n from public.product_size_merges where batch_id = batch;
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-02 buyers can read the listing map', 'ok', n = 3, 'detail', n));
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-02 buyers can read the listing map', 'ok', false, 'detail', sqlerrm));
    end;
    begin
      execute 'set local role authenticated';
      select count(source_snapshot) into n from public.product_size_merges where batch_id = batch;
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-03 buyers cannot read the saved listing snapshots', 'ok', false, 'detail', 'read ' || n));
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_array(jsonb_build_object('id', 'R-03 buyers cannot read the saved listing snapshots', 'ok', sqlstate = '42501', 'detail', sqlerrm));
    end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);

    -- Undo ----------------------------------------------------------------------------
    step := 'undo';
    update public.product_variants set price = 375, stock_quantity = 9 where id = v500;
    insert into public.product_variants (product_id, label, price) values (p250, '2 kg', 1100);
    begin
      perform public.admin_undo_size_group(batch);
      r := r || jsonb_build_array(jsonb_build_object('id', 'U-01 undo is blocked while a size added after grouping exists', 'ok', false, 'detail', 'undo succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'U-01 undo is blocked while a size added after grouping exists', 'ok', sqlerrm like 'SIZE_GROUP_UNDO_BLOCKED%', 'detail', sqlerrm));
    end;
    delete from public.product_variants where product_id = p250 and label = '2 kg';

    res := public.admin_undo_size_group(batch);
    select jsonb_agg(jsonb_build_object('name', name, 'price', price, 'mrp', mrp, 'stock', stock_quantity, 'on', is_available, 'size', serving_size) order by price)
      into jb from public.products where id in (p250, p500, p1k);
    r := r || jsonb_build_array(jsonb_build_object('id', 'U-02 undo restores every listing and keeps price and stock changes made since',
      'ok', (select name from public.products where id = p250) = base || ' - 250 g'
        and (select serving_size from public.products where id = p250) = '250 g'
        and (select description from public.products where id = p250) = 'Homemade test pickle. 250 g. Tangy.'
        and (select price from public.products where id = p500) = 375
        and (select mrp from public.products where id = p500) = 400
        and (select stock_quantity from public.products where id = p500) = 9
        and (select stock_quantity from public.products where id = p1k) = 3
        and (select count(*) from public.products where id in (p250, p500, p1k) and is_available) = 3
        and not exists (select 1 from public.product_variants where product_id = p250 and archived_at is null),
      'detail', jb));

    r := r || jsonb_build_array(jsonb_build_object('id', 'U-03 undo moves cart lines back to the original listings',
      'ok', exists (select 1 from public.cart_items where user_id = v_buyer and product_id = p500 and variant_id is null and quantity = 2)
        and exists (select 1 from public.cart_items where user_id = v_buyer and product_id = p250 and variant_id is null and quantity = 1),
      'detail', (select jsonb_agg(jsonb_build_object('p', product_id, 'v', variant_id, 'q', quantity)) from public.cart_items where user_id = v_buyer and product_id in (p250, p500, p1k))));

    r := r || jsonb_build_array(jsonb_build_object('id', 'U-04 undo removes only the favourites and alerts it added',
      'ok', not exists (select 1 from public.product_favorites where user_id = v_buyer and product_id = p250)
        and exists (select 1 from public.product_favorites where user_id = v_buyer and product_id = p1k)
        and exists (select 1 from public.product_favorites where user_id = v_fan and product_id = p250)
        and exists (select 1 from public.product_favorites where user_id = v_fan and product_id = p1k)
        and not exists (select 1 from public.stock_watchlist where user_id = v_buyer and product_id = p250)
        and exists (select 1 from public.stock_watchlist where user_id = v_buyer and product_id = p500)));

    begin
      perform public.admin_undo_size_group(batch);
      r := r || jsonb_build_array(jsonb_build_object('id', 'U-05 undoing twice is refused', 'ok', false, 'detail', 'second undo succeeded'));
    exception when others then
      r := r || jsonb_build_array(jsonb_build_object('id', 'U-05 undoing twice is refused', 'ok', sqlerrm like 'SIZE_GROUP_NOT_FOUND%', 'detail', sqlerrm));
    end;

    -- Group again after an undo ----------------------------------------------------------
    step := 'reapply';
    res := public.admin_apply_size_group(p250, sizes, base, null);
    batch2 := (res ->> 'batch_id')::uuid;
    r := r || jsonb_build_array(jsonb_build_object('id', 'G-08 the same listings can be grouped again after an undo',
      'ok', batch2 is not null and batch2 <> batch
        and (select count(*) from public.product_variants where product_id = p250 and archived_at is null) = 3
        and (select count(*) from public.product_size_merges where source_product_id in (p250, p500, p1k) and undone_at is null) = 3
        and (res ->> 'cart_lines_moved')::int = 2,
      'detail', res - 'sizes'));

    -- Existing rows untouched ---------------------------------------------------------
    step := 'existing';
    select count(*) into n from public.cart_items where user_id not in (v_buyer, v_fan);
    r := r || jsonb_build_array(jsonb_build_object('id', 'E-01 other buyers'' carts untouched', 'ok', n = cart_before, 'detail', jsonb_build_object('before', cart_before, 'after', n)));

    raise exception 'GATE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'GATE_ROLLBACK' then
      r := r || jsonb_build_array(jsonb_build_object('id', 'harness', 'ok', false, 'detail', 'step ' || step || ': ' || sqlerrm));
    end if;
  end;
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end;
$gate$;

select e->>'id' as check_id, (e->>'ok')::boolean as ok, e->'detail' as detail
from jsonb_array_elements(pg_temp.product_size_groups_gate()) e;
