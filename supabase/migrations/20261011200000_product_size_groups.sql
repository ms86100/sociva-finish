-- Product size groups: turn separate pack-size listings of one item (for example
-- "Amla Pickle - 250 g", "Amla Pickle - 500 g", "Amla Pickle - 1 kg") into one
-- product with sizes. Requires 20261011180000_product_variants_phase1.
--
-- Admin only. Suggest or build a group, preview it, apply it, and undo it.
-- The listing that becomes the product keeps its id. The other listings are
-- hidden, never deleted, because past orders point at them. product_size_merges
-- maps every old listing to the product and size that replaced it, so shared
-- links and reorders of old orders still resolve.

-- 1. Merge map -----------------------------------------------------------------

create table if not exists public.product_size_merges (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  source_product_id uuid not null references public.products(id) on delete cascade,
  target_product_id uuid not null references public.products(id) on delete cascade,
  target_variant_id uuid references public.product_variants(id) on delete set null,
  source_snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid
);

create unique index if not exists product_size_merges_source_live_key
  on public.product_size_merges (source_product_id)
  where undone_at is null;

create index if not exists product_size_merges_batch_idx
  on public.product_size_merges (batch_id);

create index if not exists product_size_merges_target_idx
  on public.product_size_merges (target_product_id);

create index if not exists product_size_merges_variant_idx
  on public.product_size_merges (target_variant_id)
  where target_variant_id is not null;

alter table public.product_size_merges enable row level security;

drop policy if exists "Size merge map is readable" on public.product_size_merges;
create policy "Size merge map is readable"
  on public.product_size_merges for select
  using (true);

-- Buyers and sellers read the mapping only; snapshots and actor ids stay private.
revoke all on public.product_size_merges from anon, authenticated;
grant select (id, batch_id, source_product_id, target_product_id, target_variant_id, created_at, undone_at)
  on public.product_size_merges to anon, authenticated;

-- 2. A hidden listing cannot be switched back on while it is part of a group ----

create or replace function public.guard_merged_product_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _target_name text;
  _label text;
begin
  if new.is_available is true and old.is_available is distinct from true then
    select t.name, v.label into _target_name, _label
    from public.product_size_merges m
    join public.products t on t.id = m.target_product_id
    left join public.product_variants v on v.id = m.target_variant_id
    where m.source_product_id = new.id
      and m.target_product_id <> new.id
      and m.undone_at is null
    limit 1;
    if found then
      raise exception 'PRODUCT_MERGED: this listing is now the % size of %. Edit that product instead.',
        coalesce(_label, 'a'), _target_name
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_merged_product_listing on public.products;
create trigger trg_guard_merged_product_listing
  before update of is_available on public.products
  for each row execute function public.guard_merged_product_listing();

-- 3. Caller check ------------------------------------------------------------------
-- Inside security definer functions current_user is the owner, so the caller is
-- read from the request JWT. No JWT means a direct database session.

create or replace function public.size_group_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if _claims is null then return; end if;
  if (_claims::jsonb ->> 'role') = 'service_role' then return; end if;
  if coalesce(public.is_admin(auth.uid()), false) then return; end if;
  raise exception 'NOT_ADMIN: only an admin can group listings into sizes' using errcode = '42501';
end;
$function$;

-- 4. Preview -----------------------------------------------------------------------
-- _sizes: [{"product_id": "...", "label": "250 g"}, ...] in the order buyers see them.
-- _parent_id must be one of them; it keeps its id and becomes the product.
-- _name / _description: the product's new text (null keeps the current text).

create or replace function public.admin_size_group_plan(
  _parent_id uuid,
  _sizes jsonb,
  _name text default null,
  _description text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _blockers text[] := '{}';
  _warnings text[] := '{}';
  _parent public.products;
  _p public.products;
  _e jsonb;
  _rows jsonb := '[]'::jsonb;
  _ids uuid[] := '{}';
  _labels text[] := '{}';
  _label text;
  _i int := 0;
  _n int;
  _carts int := 0;
  _favs int := 0;
  _watch int := 0;
  _orders int := 0;
  _cnt int;
  _from numeric;
  _final_name text;
  _final_desc text;
begin
  perform public.size_group_assert_admin();

  if _sizes is null or jsonb_typeof(_sizes) <> 'array' then
    raise exception 'SIZE_GROUP_INVALID: sizes must be a list' using errcode = 'P0001';
  end if;

  select * into _parent from public.products where id = _parent_id;
  if not found then
    raise exception 'SIZE_GROUP_INVALID: product % not found', _parent_id using errcode = 'P0001';
  end if;

  _n := jsonb_array_length(_sizes);
  if _n < 2 then _blockers := _blockers || 'Pick at least two listings to group'::text; end if;
  if _n > 20 then _blockers := _blockers || 'A product can have at most 20 sizes'::text; end if;
  if not public.product_action_allows_variants(_parent.action_type) then
    _blockers := _blockers || 'Sizes are only available for Add to Cart products'::text;
  end if;

  for _e in select value from jsonb_array_elements(_sizes) loop
    _i := _i + 1;
    select * into _p from public.products where id = nullif(_e ->> 'product_id', '')::uuid;
    if not found then
      _blockers := _blockers || format('Size %s: listing not found', _i);
      continue;
    end if;

    _label := regexp_replace(btrim(coalesce(_e ->> 'label', '')), '\s+', ' ', 'g');
    if _p.id = any(_ids) then
      _blockers := _blockers || format('%s is listed twice', _p.name);
    end if;
    _ids := _ids || _p.id;
    if length(_label) < 1 or length(_label) > 40 then
      _blockers := _blockers || format('%s: size name must be 1 to 40 characters', _p.name);
    elsif lower(_label) = any(_labels) then
      _blockers := _blockers || format('Size name "%s" is used twice', _label);
    end if;
    _labels := _labels || lower(_label);

    if _p.seller_id <> _parent.seller_id then
      _blockers := _blockers || format('%s belongs to a different store', _p.name);
    end if;
    if _p.category is distinct from _parent.category then
      _blockers := _blockers || format('%s is in a different category', _p.name);
    end if;
    if _p.action_type is distinct from _parent.action_type then
      _blockers := _blockers || format('%s is sold a different way', _p.name);
    end if;
    if _p.approval_status <> 'approved' then
      _blockers := _blockers || format('%s is not approved yet (%s)', _p.name, _p.approval_status);
    end if;
    if _p.price is null or _p.price <= 0 then
      _blockers := _blockers || format('%s needs a price above 0', _p.name);
    end if;
    if exists (select 1 from public.product_variants v where v.product_id = _p.id and v.archived_at is null) then
      _blockers := _blockers || format('%s already has sizes', _p.name);
    end if;
    if exists (
      select 1 from public.product_size_merges m
      where m.undone_at is null and (m.source_product_id = _p.id or m.target_product_id = _p.id)
    ) then
      _blockers := _blockers || format('%s is already part of a size group', _p.name);
    end if;

    if _p.id <> _parent_id then
      select count(*) into _cnt from public.subscriptions s where s.product_id = _p.id;
      if _cnt > 0 then
        _blockers := _blockers || format('%s has %s subscription(s); move them first', _p.name, _cnt);
      end if;
      select count(*) into _cnt from public.banner_section_products b where b.product_id = _p.id;
      if _cnt > 0 then
        _blockers := _blockers || format('%s is placed in %s banner(s); move them first', _p.name, _cnt);
      end if;
      if not coalesce(_p.is_available, true) then
        if exists (select 1 from public.cart_items c where c.product_id = _p.id) then
          _blockers := _blockers || format('%s is switched off but still in carts', _p.name);
        else
          _warnings := _warnings || format('%s is switched off now; its size will start switched off', _p.name);
        end if;
      end if;
      select count(*) into _cnt from public.product_favorites f where f.product_id = _p.id;
      _favs := _favs + _cnt;
      select count(*) into _cnt from public.stock_watchlist w where w.product_id = _p.id;
      _watch := _watch + _cnt;
    end if;

    select count(*) into _cnt from public.cart_items c where c.product_id = _p.id and c.variant_id is null;
    _carts := _carts + _cnt;
    select count(*) into _cnt from public.order_items oi where oi.product_id = _p.id;
    _orders := _orders + _cnt;

    _rows := _rows || jsonb_build_array(jsonb_build_object(
      'product_id', _p.id,
      'current_name', _p.name,
      'label', _label,
      'price', _p.price,
      'compare_at_price', case when _p.mrp > _p.price then _p.mrp end,
      'stock_quantity', _p.stock_quantity,
      'is_active', coalesce(_p.is_available, true),
      'image_url', _p.image_url,
      'is_parent', _p.id = _parent_id,
      'after', case when _p.id = _parent_id then 'becomes the product' else 'hidden, kept for order history' end
    ));
  end loop;

  if not (_parent_id = any(_ids)) then
    _blockers := _blockers || 'The product to keep must be one of the listings'::text;
  end if;

  _final_name := btrim(coalesce(nullif(btrim(_name), ''), _parent.name));
  _final_desc := case when _description is null then _parent.description else nullif(btrim(_description), '') end;
  if length(_final_name) < 2 then
    _blockers := _blockers || 'The product needs a name'::text;
  end if;

  select min((r ->> 'price')::numeric) into _from
  from jsonb_array_elements(_rows) r
  where (r ->> 'is_active')::boolean;

  return jsonb_build_object(
    'ok', cardinality(_blockers) = 0,
    'blockers', to_jsonb(_blockers),
    'warnings', to_jsonb(_warnings),
    'parent_id', _parent_id,
    'previous_name', _parent.name,
    'name', _final_name,
    'description', _final_desc,
    'from_price', _from,
    'sizes', _rows,
    'cart_lines_to_move', _carts,
    'favorites_to_copy', _favs,
    'watchers_to_copy', _watch,
    'past_order_lines', _orders
  );
end;
$function$;

-- 5. Apply ---------------------------------------------------------------------------

create or replace function public.admin_apply_size_group(
  _parent_id uuid,
  _sizes jsonb,
  _name text default null,
  _description text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _plan jsonb;
  _batch uuid := gen_random_uuid();
  _s jsonb;
  _src public.products;
  _vid uuid;
  _i int := 0;
  _fav uuid[];
  _watch uuid[];
  _moved int;
  _carts int := 0;
begin
  perform public.size_group_assert_admin();

  -- Lock every listing in the group so nothing changes between the check and the writes.
  perform 1 from public.products
  where id in (select nullif(e ->> 'product_id', '')::uuid from jsonb_array_elements(_sizes) e)
  order by id
  for update;

  _plan := public.admin_size_group_plan(_parent_id, _sizes, _name, _description);
  if jsonb_array_length(_plan -> 'blockers') > 0 then
    raise exception 'SIZE_GROUP_BLOCKED: %',
      (select string_agg(b, '; ') from jsonb_array_elements_text(_plan -> 'blockers') b)
      using errcode = 'P0001';
  end if;

  for _s in select value from jsonb_array_elements(_plan -> 'sizes') loop
    select * into _src from public.products where id = (_s ->> 'product_id')::uuid;

    insert into public.product_variants (
      product_id, label, price, compare_at_price, stock_quantity, low_stock_threshold,
      is_active, sort_order, image_url
    ) values (
      _parent_id, _s ->> 'label', _src.price,
      case when _src.mrp > _src.price then _src.mrp end,
      _src.stock_quantity, _src.low_stock_threshold,
      coalesce(_src.is_available, true), _i, _src.image_url
    )
    returning id into _vid;
    _i := _i + 1;

    _fav := '{}';
    _watch := '{}';
    if _src.id <> _parent_id then
      with ins as (
        insert into public.product_favorites (user_id, product_id)
        select f.user_id, _parent_id from public.product_favorites f where f.product_id = _src.id
        on conflict (user_id, product_id) do nothing
        returning user_id
      )
      select coalesce(array_agg(user_id), '{}') into _fav from ins;

      with ins as (
        insert into public.stock_watchlist (user_id, product_id)
        select w.user_id, _parent_id from public.stock_watchlist w where w.product_id = _src.id
        on conflict (user_id, product_id) do nothing
        returning user_id
      )
      select coalesce(array_agg(user_id), '{}') into _watch from ins;
    end if;

    -- Each listing maps to its own new size, so a moved line never collides with another line.
    update public.cart_items
    set product_id = _parent_id, variant_id = _vid
    where product_id = _src.id and variant_id is null;
    get diagnostics _moved = row_count;
    _carts := _carts + _moved;

    insert into public.product_size_merges (
      batch_id, source_product_id, target_product_id, target_variant_id, source_snapshot, created_by
    ) values (
      _batch, _src.id, _parent_id, _vid,
      jsonb_build_object(
        'name', _src.name,
        'description', _src.description,
        'serving_size', _src.serving_size,
        'price', _src.price,
        'mrp', _src.mrp,
        'stock_quantity', _src.stock_quantity,
        'is_available', _src.is_available,
        'added_favorite_user_ids', to_jsonb(_fav),
        'added_watch_user_ids', to_jsonb(_watch)
      ),
      auth.uid()
    );
  end loop;

  update public.products
  set is_available = false
  where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(_plan -> 'sizes') e)
    and id <> _parent_id;

  -- Price and stock were already moved onto the sizes by trg_sync_product_from_variants.
  update public.products
  set name = _plan ->> 'name',
      description = _plan ->> 'description',
      serving_size = null,
      mrp = null
  where id = _parent_id;

  return _plan || jsonb_build_object('applied', true, 'batch_id', _batch, 'cart_lines_moved', _carts);
end;
$function$;

-- 6. Undo ------------------------------------------------------------------------------
-- Restores every listing with its size's current price, MRP, stock and on/off state,
-- so changes the seller made after grouping are kept.

create or replace function public.admin_undo_size_group(_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _target uuid;
  _m record;
  _v public.product_variants;
  _extra int;
  _moved int;
  _carts int := 0;
begin
  perform public.size_group_assert_admin();

  select target_product_id into _target
  from public.product_size_merges
  where batch_id = _batch_id and undone_at is null
  limit 1;
  if _target is null then
    raise exception 'SIZE_GROUP_NOT_FOUND: nothing to undo for this group' using errcode = 'P0001';
  end if;

  perform 1 from public.products
  where id in (select source_product_id from public.product_size_merges where batch_id = _batch_id)
  order by id
  for update;

  select count(*) into _extra
  from public.product_variants v
  where v.product_id = _target
    and v.archived_at is null
    and v.id not in (
      select m.target_variant_id from public.product_size_merges m
      where m.batch_id = _batch_id and m.target_variant_id is not null
    );
  if _extra > 0 then
    raise exception 'SIZE_GROUP_UNDO_BLOCKED: % size(s) were added to this product after grouping. Remove them first.', _extra
      using errcode = 'P0001';
  end if;

  update public.product_size_merges
  set undone_at = now(), undone_by = auth.uid()
  where batch_id = _batch_id and undone_at is null;

  -- Archive first so the product accepts unsized cart lines again. is_active is left
  -- as the seller last set it and carried back to the listing below.
  update public.product_variants
  set archived_at = now()
  where id in (select target_variant_id from public.product_size_merges where batch_id = _batch_id)
    and archived_at is null;

  for _m in select * from public.product_size_merges where batch_id = _batch_id loop
    select * into _v from public.product_variants where id = _m.target_variant_id;

    if _m.target_variant_id is not null then
      update public.cart_items t
      set quantity = t.quantity + s.quantity
      from public.cart_items s
      where s.variant_id = _m.target_variant_id
        and t.user_id = s.user_id
        and t.product_id = _m.source_product_id
        and t.variant_id is null;
      delete from public.cart_items s
      where s.variant_id = _m.target_variant_id
        and exists (
          select 1 from public.cart_items t
          where t.user_id = s.user_id and t.product_id = _m.source_product_id and t.variant_id is null
        );
      update public.cart_items
      set product_id = _m.source_product_id, variant_id = null
      where variant_id = _m.target_variant_id;
      get diagnostics _moved = row_count;
      _carts := _carts + _moved;
    end if;

    update public.products p
    set price = coalesce(_v.price, (_m.source_snapshot ->> 'price')::numeric),
        mrp = case when _v.id is not null then _v.compare_at_price else (_m.source_snapshot ->> 'mrp')::numeric end,
        stock_quantity = case when _v.id is not null then _v.stock_quantity else (_m.source_snapshot ->> 'stock_quantity')::int end,
        is_available = case
          when p.id = _target then p.is_available
          when _v.id is not null then _v.is_active
          else coalesce((_m.source_snapshot ->> 'is_available')::boolean, true)
        end,
        name = case when p.id = _target then _m.source_snapshot ->> 'name' else p.name end,
        description = case when p.id = _target then _m.source_snapshot ->> 'description' else p.description end,
        serving_size = case when p.id = _target then _m.source_snapshot ->> 'serving_size' else p.serving_size end
    where p.id = _m.source_product_id;

    delete from public.product_favorites
    where product_id = _target
      and user_id in (select jsonb_array_elements_text(_m.source_snapshot -> 'added_favorite_user_ids')::uuid);
    delete from public.stock_watchlist
    where product_id = _target
      and user_id in (select jsonb_array_elements_text(_m.source_snapshot -> 'added_watch_user_ids')::uuid);
  end loop;

  return jsonb_build_object('undone', true, 'batch_id', _batch_id, 'product_id', _target, 'cart_lines_moved', _carts);
end;
$function$;

-- 7. Suggestions ------------------------------------------------------------------------
-- Finds listings named "<item> - <amount><unit>" in one store and proposes a group per
-- item: sizes cheapest first, the cheapest listing kept as the product, and the size
-- removed from its name and description. Nothing is written.

create or replace function public.admin_suggest_size_groups(_seller_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _out jsonb;
begin
  perform public.size_group_assert_admin();

  with c as (
    select p.id, p.name, p.price, p.category, p.description,
           btrim(m[1]) as base,
           regexp_replace(btrim(m[2]), '\s+', ' ', 'g') as label
    from public.products p
    cross join lateral regexp_match(
      p.name,
      '^(.*\S)\s+-\s+(\d+(?:\.\d+)?\s*(?:g|gm|gms|gram|grams|kg|kgs|ml|l|ltr|litre|litres|liter|liters|pc|pcs|piece|pieces))$',
      'i'
    ) m
    where m is not null
      and p.seller_id = _seller_id
      and p.approval_status = 'approved'
      and public.product_action_allows_variants(p.action_type)
      and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.archived_at is null)
      and not exists (
        select 1 from public.product_size_merges sm
        where sm.undone_at is null and (sm.source_product_id = p.id or sm.target_product_id = p.id)
      )
  ),
  g as (
    select lower(base) as k, category, min(base) as base,
           jsonb_agg(jsonb_build_object('product_id', id, 'label', label, 'price', price, 'current_name', name)
                     order by price, label) as sizes,
           (array_agg(id order by price, label))[1] as parent_id,
           (array_agg(label order by price, label))[1] as parent_label
    from c
    group by lower(base), category
    having count(*) >= 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', g.base,
           'parent_id', g.parent_id,
           'description', nullif(btrim(regexp_replace(
             regexp_replace(
               coalesce(pp.description, ''),
               -- Labels match the pattern above: digits, an optional dot, spaces and a unit.
               '\s*' || replace(g.parent_label, '.', '\.') || '\.?(?=\s|$)',
               '', 'i'),
             '\s{2,}', ' ', 'g')), ''),
           'sizes', g.sizes
         ) order by g.base), '[]'::jsonb)
    into _out
  from g
  join public.products pp on pp.id = g.parent_id;

  return _out;
end;
$function$;

-- 8. Access ---------------------------------------------------------------------------

revoke all on function public.size_group_assert_admin() from public, anon;
revoke all on function public.admin_size_group_plan(uuid, jsonb, text, text) from public, anon;
revoke all on function public.admin_apply_size_group(uuid, jsonb, text, text) from public, anon;
revoke all on function public.admin_undo_size_group(uuid) from public, anon;
revoke all on function public.admin_suggest_size_groups(uuid) from public, anon;

grant execute on function public.size_group_assert_admin() to authenticated, service_role;
grant execute on function public.admin_size_group_plan(uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.admin_apply_size_group(uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.admin_undo_size_group(uuid) to authenticated, service_role;
grant execute on function public.admin_suggest_size_groups(uuid) to authenticated, service_role;
