-- Product variants (pack sizes) - phase 1: additive schema and server branch.
--
-- Products without variants keep the exact legacy path: cart lines and order
-- lines carry variant_id NULL, price and stock come from products.
-- Products with variants are purchased only through a variant: price and stock
-- come from product_variants, products.price is kept as the lowest active
-- variant price for display, and products.stock_quantity is not used.

-- 1. Variant table ---------------------------------------------------------

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  price numeric(10,2) not null,
  compare_at_price numeric(10,2),
  stock_quantity integer,
  low_stock_threshold integer,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  image_url text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_label_len check (length(btrim(label)) between 1 and 40),
  constraint product_variants_price_positive check (price > 0),
  constraint product_variants_compare_at check (compare_at_price is null or compare_at_price >= price),
  constraint product_variants_stock_nonneg check (stock_quantity is null or stock_quantity >= 0),
  constraint product_variants_threshold_nonneg check (low_stock_threshold is null or low_stock_threshold >= 0)
);

create unique index if not exists product_variants_product_label_live_key
  on public.product_variants (product_id, lower(btrim(label)))
  where archived_at is null;

create index if not exists product_variants_product_idx
  on public.product_variants (product_id);

alter table public.product_variants enable row level security;

drop policy if exists "Variants visible with their product" on public.product_variants;
create policy "Variants visible with their product"
  on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_variants.product_id));

drop policy if exists "Sellers insert variants for own products" on public.product_variants;
create policy "Sellers insert variants for own products"
  on public.product_variants for insert
  with check (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_variants.product_id and sp.user_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

drop policy if exists "Sellers update variants for own products" on public.product_variants;
create policy "Sellers update variants for own products"
  on public.product_variants for update
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_variants.product_id and sp.user_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

drop policy if exists "Sellers delete variants for own products" on public.product_variants;
create policy "Sellers delete variants for own products"
  on public.product_variants for delete
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_variants.product_id and sp.user_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

grant select on public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_variants to authenticated;

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.update_updated_at();

-- 2. Nullable variant references on cart and order lines -------------------

alter table public.cart_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete cascade;

-- Deferred so a product delete that cascades to its sizes can null this column
-- before the key is checked, even for order lines written in the same transaction.
alter table public.order_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null deferrable initially deferred,
  add column if not exists variant_label text;

create index if not exists cart_items_variant_idx on public.cart_items (variant_id) where variant_id is not null;
create index if not exists order_items_variant_idx on public.order_items (variant_id) where variant_id is not null;

-- 3. Cart uniqueness: (user, product, variant) with NULL treated as one value.
--    The new key is created and checked before the old key is dropped, so a
--    failure leaves the legacy key in place.

do $$
declare
  _before bigint;
  _dupes bigint;
begin
  select count(*) into _before from public.cart_items;

  select count(*) into _dupes from (
    select user_id, product_id, variant_id
    from public.cart_items
    group by user_id, product_id, variant_id
    having count(*) > 1
  ) d;
  if _dupes > 0 then
    raise exception 'cart_items has % duplicate (user, product, variant) groups; aborting key swap', _dupes;
  end if;

  if to_regclass('public.cart_items_user_product_variant_key') is null then
    create unique index cart_items_user_product_variant_key
      on public.cart_items (user_id, product_id, variant_id) nulls not distinct;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.cart_items'::regclass
      and conname = 'cart_items_user_id_product_id_key'
  ) then
    alter table public.cart_items drop constraint cart_items_user_id_product_id_key;
  end if;

  if (select count(*) from public.cart_items) <> _before then
    raise exception 'cart_items row count changed during key swap';
  end if;
end $$;

-- 4. Cart line validation ---------------------------------------------------

create or replace function public.validate_cart_item_variant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.variant_id is not null then
    if not exists (
      select 1 from public.product_variants v
      where v.id = new.variant_id
        and v.product_id = new.product_id
        and v.is_active
        and v.archived_at is null
    ) then
      raise exception 'VARIANT_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  elsif exists (
    select 1 from public.product_variants v
    where v.product_id = new.product_id and v.archived_at is null
  ) then
    raise exception 'VARIANT_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_cart_item_variant on public.cart_items;
create trigger trg_validate_cart_item_variant
  before insert or update of product_id, variant_id on public.cart_items
  for each row execute function public.validate_cart_item_variant();

create or replace function public.enforce_cart_stock_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE _stock integer;
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    SELECT stock_quantity INTO _stock FROM product_variants WHERE id = NEW.variant_id;
  ELSE
    SELECT stock_quantity INTO _stock FROM products WHERE id = NEW.product_id;
  END IF;
  IF _stock IS NOT NULL AND NEW.quantity > _stock THEN RAISE EXCEPTION 'Requested quantity (%) exceeds available stock (%)', NEW.quantity, _stock; END IF;
  RETURN NEW;
END;
$function$;

-- 5. Variant lifecycle -------------------------------------------------------

-- A variant that a cart or an order points at can be deactivated or archived,
-- not deleted. Deleting the whole product still cascades (trigger depth > 1).
create or replace function public.guard_product_variant_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if pg_trigger_depth() = 1 and (
    exists (select 1 from public.order_items oi where oi.variant_id = old.id)
    or exists (select 1 from public.cart_items ci where ci.variant_id = old.id)
  ) then
    raise exception 'VARIANT_IN_USE: deactivate this size instead of deleting it' using errcode = 'P0001';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_guard_product_variant_delete on public.product_variants;
create trigger trg_guard_product_variant_delete
  before delete on public.product_variants
  for each row execute function public.guard_product_variant_delete();

-- Sizes exist only for products bought through the cart. Whether an action
-- type is a cart action comes from action_type_workflow_map, the same table
-- checkout reads; unmapped or missing action types follow checkout and pass.
create or replace function public.product_action_allows_variants(_action_type text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select _action_type is null
    or coalesce((
      select atm.checkout_mode = 'cart'
      from public.action_type_workflow_map atm
      where atm.action_type = _action_type
    ), true);
$function$;

create or replace function public.guard_product_variant_action()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.product_action_allows_variants(
    (select p.action_type from public.products p where p.id = new.product_id)
  ) then
    raise exception 'VARIANTS_NOT_SUPPORTED: sizes are only available for Add to Cart products' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_product_variant_action on public.product_variants;
create trigger trg_guard_product_variant_action
  before insert or update of product_id on public.product_variants
  for each row execute function public.guard_product_variant_action();

create or replace function public.guard_product_action_with_variants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.product_action_allows_variants(new.action_type)
    and exists (
      select 1 from public.product_variants v
      where v.product_id = new.id and v.archived_at is null
    )
  then
    raise exception 'VARIANTS_NOT_SUPPORTED: remove this product''s sizes before changing how it is sold' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_product_action_with_variants on public.products;
create trigger trg_guard_product_action_with_variants
  before update of action_type on public.products
  for each row
  when (new.action_type is distinct from old.action_type)
  execute function public.guard_product_action_with_variants();

-- Keep products.price at the lowest live variant price (display and sorting)
-- and clear parent stock so variant stock is the only stock for that product.
create or replace function public.sync_product_from_variants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _pid uuid := coalesce(new.product_id, old.product_id);
  _min numeric;
  _has_live boolean;
begin
  select exists (
    select 1 from public.product_variants v
    where v.product_id = _pid and v.archived_at is null
  ) into _has_live;

  if not _has_live then
    return null;
  end if;

  select min(v.price) into _min
  from public.product_variants v
  where v.product_id = _pid and v.is_active and v.archived_at is null;

  update public.products p
  set price = coalesce(_min, p.price),
      stock_quantity = null
  where p.id = _pid
    and (p.price is distinct from coalesce(_min, p.price) or p.stock_quantity is not null);

  return null;
end;
$function$;

drop trigger if exists trg_sync_product_from_variants on public.product_variants;
create trigger trg_sync_product_from_variants
  after insert or update of price, is_active, archived_at or delete on public.product_variants
  for each row execute function public.sync_product_from_variants();

-- 6. Variant low-stock and out-of-stock alerts --------------------------------
-- Mirrors fn_alert_seller_low_stock for tracked variant stock. Untracked (NULL)
-- stock never alerts. A size at 0 cannot be bought; other sizes and the parent
-- product stay live.
create or replace function public.fn_alert_seller_low_variant_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _threshold integer;
  _seller_user_id uuid;
  _society_id uuid;
  _seller_threshold integer;
  _product_name text;
  _display text;
begin
  if new.stock_quantity is null or old.stock_quantity is null then return new; end if;
  if new.stock_quantity >= old.stock_quantity then return new; end if;

  select p.name, sp.user_id, sp.society_id, sp.low_stock_alert_threshold
    into _product_name, _seller_user_id, _society_id, _seller_threshold
  from public.products p
  join public.seller_profiles sp on sp.id = p.seller_id
  where p.id = new.product_id;

  if _seller_user_id is null then return new; end if;

  _threshold := coalesce(new.low_stock_threshold, _seller_threshold, 5);
  _display := coalesce(_product_name, 'Product') || ' (' || new.label || ')';

  if old.stock_quantity > _threshold and new.stock_quantity <= _threshold and new.stock_quantity > 0 then
    insert into public.notification_queue (user_id, title, body, type, reference_path, action_url, society_id, payload)
    values (
      _seller_user_id,
      'Low Stock Alert',
      _display || ' has only ' || new.stock_quantity || ' left. Restock soon!',
      'low_stock',
      '/seller/products',
      '/seller/products',
      _society_id,
      jsonb_build_object('product_id', new.product_id, 'variant_id', new.id, 'stock_quantity', new.stock_quantity, 'threshold', _threshold)
    );
  end if;

  if new.stock_quantity = 0 and old.stock_quantity > 0 then
    insert into public.notification_queue (user_id, title, body, type, reference_path, action_url, society_id, payload)
    values (
      _seller_user_id,
      'Out of Stock',
      _display || ' is now out of stock. Buyers cannot order this size until you restock.',
      'out_of_stock',
      '/seller/products',
      '/seller/products',
      _society_id,
      jsonb_build_object('product_id', new.product_id, 'variant_id', new.id)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_alert_seller_low_variant_stock on public.product_variants;
create trigger trg_alert_seller_low_variant_stock
  after update of stock_quantity on public.product_variants
  for each row execute function public.fn_alert_seller_low_variant_stock();

-- 7. Cancel restore and payment rehold -------------------------------------------

CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel_impl(p_old orders, p_new orders)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Restore on all fail terminals that free inventory
  IF p_new.status::text IN ('cancelled', 'rejected')
     AND p_old.status::text IS DISTINCT FROM p_new.status::text THEN
    UPDATE public.products p
    SET
      stock_quantity = p.stock_quantity + oi.quantity,
      is_available = CASE
        WHEN p.stock_quantity + oi.quantity > 0 THEN true
        ELSE p.is_available
      END
    FROM public.order_items oi
    WHERE oi.order_id = p_new.id
      AND oi.product_id = p.id
      AND oi.variant_id IS NULL
      AND p.stock_quantity IS NOT NULL
      AND COALESCE(oi.stock_restored, false) = false;

    UPDATE public.product_variants v
    SET stock_quantity = v.stock_quantity + s.qty
    FROM (
      SELECT oi.variant_id, SUM(oi.quantity)::int AS qty
      FROM public.order_items oi
      WHERE oi.order_id = p_new.id
        AND oi.variant_id IS NOT NULL
        AND COALESCE(oi.stock_restored, false) = false
      GROUP BY oi.variant_id
    ) s
    WHERE v.id = s.variant_id
      AND v.stock_quantity IS NOT NULL;

    UPDATE public.order_items
    SET stock_restored = true
    WHERE order_id = p_new.id
      AND COALESCE(stock_restored, false) = false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rehold_stock_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_updated int := 0;
BEGIN
  FOR r IN
    SELECT oi.id AS item_id, oi.product_id, oi.variant_id, oi.quantity, oi.stock_restored
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    -- Only re-hold units that were restored on cancel/reject (idempotent)
    IF COALESCE(r.stock_restored, false) IS NOT TRUE THEN
      CONTINUE;
    END IF;

    IF r.variant_id IS NOT NULL THEN
      UPDATE public.product_variants v
      SET stock_quantity = v.stock_quantity - r.quantity
      WHERE v.id = r.variant_id
        AND v.stock_quantity IS NOT NULL
        AND v.stock_quantity >= r.quantity;

      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1 FROM public.product_variants v
          WHERE v.id = r.variant_id AND v.stock_quantity IS NOT NULL
        ) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'insufficient_stock',
            'product_id', r.product_id,
            'variant_id', r.variant_id
          );
        END IF;
        -- Non-tracked stock: clear flag anyway
      ELSE
        v_updated := v_updated + 1;
      END IF;
    ELSE
      UPDATE public.products p
      SET stock_quantity = p.stock_quantity - r.quantity,
          is_available = CASE
            WHEN p.stock_quantity - r.quantity <= 0 THEN false
            ELSE p.is_available
          END
      WHERE p.id = r.product_id
        AND p.stock_quantity IS NOT NULL
        AND p.stock_quantity >= r.quantity;

      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = r.product_id AND p.stock_quantity IS NOT NULL
        ) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'insufficient_stock',
            'product_id', r.product_id
          );
        END IF;
        -- Non-tracked stock: clear flag anyway
      ELSE
        v_updated := v_updated + 1;
      END IF;
    END IF;

    UPDATE public.order_items
    SET stock_restored = false
    WHERE id = r.item_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'items_reheld', v_updated);
END;
$function$;

-- 8. Checkout ----------------------------------------------------------------------
-- Based on the live production body. Changes are limited to: variant-aware
-- validation, variant_id/variant_label on order_items, and variant stock
-- decrement. The idempotency early return still runs before any of them.

CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _fulfillment_type text DEFAULT 'delivery'::text, _delivery_address text DEFAULT NULL::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision, _notes text DEFAULT NULL::text, _payment_method text DEFAULT 'cod'::text, _payment_status text DEFAULT 'pending'::text, _delivery_fee numeric DEFAULT 0, _coupon_id text DEFAULT NULL::text, _coupon_discount numeric DEFAULT 0, _idempotency_key text DEFAULT NULL::text, _preorder_seller_ids uuid[] DEFAULT NULL::uuid[], _scheduled_date text DEFAULT NULL::text, _scheduled_time_start text DEFAULT NULL::text, _loyalty_points integer DEFAULT 0, _wallet_amount numeric DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _seller_group json;
  _order_id uuid;
  _order_ids uuid[] := '{}';
  _item json;
  _society_id uuid;
  _total numeric;
  _seller_user_id uuid;
  _buyer_name text;
  _seller_id uuid;
  _seller_name text;
  _seller_society_id uuid;
  _seller_status jsonb;
  _seller_status_text text;
  _closed_sellers text[] := '{}';
  _credit_blocked_sellers text[] := '{}';
  _credit_gate jsonb;
  _seller_lat double precision;
  _seller_lng double precision;
  _seller_radius double precision;
  _distance double precision;
  _out_of_range text[] := '{}';
  _group_count int := 0;
  _total_groups int;
  _resolved_coupon_id uuid;
  _first_order_id uuid;
  _seller_fulfillment_mode text;
  _delivery_handled_by text;
  _existing_order_ids uuid[];
  _row_idempotency_key text;
  _auto_cancel_at timestamptz;
  _effective_status text;
  _effective_scheduled_date text;
  _effective_scheduled_time text;
  _product_id uuid;
  _product_row record;
  _client_price numeric;
  _client_qty int;
  _unavailable_items text[] := '{}';
  _price_changed_items text[] := '{}';
  _stock_insufficient text[] := '{}';
  _payment_blocked_sellers text[] := '{}';
  _seller_payment_config jsonb;
  _config_accepts_cod boolean;
  _config_accepts_online boolean;
  _resolved_tx_type text;
  _item_checkout_mode text;
  _non_cart_items text[] := '{}';
  _resolved_product_name text;
  _resolved_product_image text;
  _stock_rows int;
  _tracks_stock boolean;
  _loyalty_result jsonb;
  _wallet_result jsonb;
  _skipped_sellers text[] := '{}';
  _created_count int;
  _packaging_fee numeric := 0;
  _variant_id uuid;
  _variant_row record;
  _has_variants boolean;
  _resolved_variant_label text;
begin
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  _delivery_fee := public.resolve_platform_delivery_fee(
    coalesce(_fulfillment_type, 'delivery'),
    _seller_groups
  );

  if _payment_status = 'pending' and _payment_method <> 'cod' then
    _effective_status := 'payment_pending';
  else
    _effective_status := 'placed';
  end if;

  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(_idempotency_key));
  end if;

  if _idempotency_key is not null then
    select array_agg(o.id order by o.created_at, o.id)
      into _existing_order_ids
    from public.orders o
    where o.buyer_id = _buyer_id
      and o.idempotency_key like _idempotency_key || ':%';

    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids), 'deduplicated', true);
    end if;
  end if;

  _resolved_coupon_id := NULLIF(_coupon_id, '')::uuid;

  select p.society_id, p.name into _society_id, _buyer_name
  from public.profiles p where p.id = _buyer_id;

  if _society_id is null then
    return json_build_object(
      'success', false,
      'error', 'buyer_society_required',
      'message', 'Link your account to a society in Profile settings before placing an order.'
    );
  end if;

  select json_array_length(_seller_groups) into _total_groups;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _client_price := (_item->>'unit_price')::numeric;
      _client_qty := (_item->>'quantity')::int;

      select id, name, price, is_available, approval_status, seller_id, stock_quantity, action_type
        into _product_row
        from public.products
        where id = _product_id
        for update;

      if _product_row is null then
        _unavailable_items := array_append(_unavailable_items, COALESCE((_item->>'product_name')::text, _product_id::text));
        continue;
      end if;

      if not _product_row.is_available or _product_row.approval_status <> 'approved' then
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text));
        continue;
      end if;

      if _product_row.seller_id <> _seller_id then
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text));
        continue;
      end if;

      if _product_row.action_type is not null then
        select atm.checkout_mode into _item_checkout_mode
        from public.action_type_workflow_map atm
        where atm.action_type = _product_row.action_type;

        if _item_checkout_mode is not null and _item_checkout_mode <> 'cart' then
          _non_cart_items := array_append(_non_cart_items, COALESCE(_product_row.name, _product_id::text));
          continue;
        end if;
      end if;

      _variant_id := NULLIF(_item->>'variant_id', '')::uuid;
      select exists (
        select 1 from public.product_variants pv
        where pv.product_id = _product_id and pv.archived_at is null
      ) into _has_variants;

      if _variant_id is not null or _has_variants then
        if _variant_id is null then
          _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text) || ' (choose a size)');
          continue;
        end if;

        select id, label, price, stock_quantity, is_active, archived_at
          into _variant_row
          from public.product_variants
          where id = _variant_id and product_id = _product_id
          for update;

        if not found or not _variant_row.is_active or _variant_row.archived_at is not null then
          _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text) || ' (size no longer available)');
          continue;
        end if;

        if _variant_row.stock_quantity is not null and _variant_row.stock_quantity < _client_qty then
          _stock_insufficient := array_append(_stock_insufficient, COALESCE(_product_row.name, _product_id::text) || ' ' || _variant_row.label || ' (available: ' || _variant_row.stock_quantity || ')');
          continue;
        end if;

        if _variant_row.price is distinct from _client_price then
          _price_changed_items := array_append(_price_changed_items,
            COALESCE(_product_row.name, _product_id::text) || ' ' || _variant_row.label || ' (was INR ' || _client_price || ', now INR ' || _variant_row.price || ')'
          );
        end if;
        continue;
      end if;

      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient, COALESCE(_product_row.name, _product_id::text) || ' (available: ' || _product_row.stock_quantity || ')');
        continue;
      end if;

      if _product_row.price is distinct from _client_price then
        _price_changed_items := array_append(_price_changed_items,
          COALESCE(_product_row.name, _product_id::text) || ' (was INR ' || _client_price || ', now INR ' || _product_row.price || ')'
        );
      end if;
    end loop;
  end loop;

  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'unavailable_items', 'items', to_json(_unavailable_items));
  end if;

  if array_length(_non_cart_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'non_cart_items', 'items', to_json(_non_cart_items),
      'message', 'Some items cannot be ordered via cart');
  end if;

  if array_length(_stock_insufficient, 1) > 0 then
    return json_build_object('success', false, 'error', 'insufficient_stock', 'items', to_json(_stock_insufficient));
  end if;

  if array_length(_price_changed_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'price_changed', 'items', to_json(_price_changed_items));
  end if;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.user_id, sp.business_name, sp.society_id,
           public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until),
           sp.latitude, sp.longitude, sp.delivery_radius_km,
           sp.fulfillment_mode, sp.delivery_handled_by,
           GREATEST(COALESCE(sp.packaging_fee, 0), 0),
           case
             when _fulfillment_type = 'self_pickup' then sp.pickup_payment_config
             else sp.delivery_payment_config
           end
    into _seller_user_id, _seller_name, _seller_society_id, _seller_status,
         _seller_lat, _seller_lng, _seller_radius,
         _seller_fulfillment_mode, _delivery_handled_by,
         _packaging_fee,
         _seller_payment_config
    from public.seller_profiles sp where sp.id = _seller_id;

    if _seller_society_id is null then
      return json_build_object(
        'success', false,
        'error', 'seller_society_required',
        'message', 'Store "' || COALESCE(_seller_name, 'Unknown') || '" is not linked to a society.',
        'seller', COALESCE(_seller_name, _seller_id::text)
      );
    end if;

    if not public.seller_has_resolvable_location(_seller_id) then
      return json_build_object(
        'success', false,
        'error', 'seller_location_required',
        'message', 'Store "' || COALESCE(_seller_name, 'Unknown') || '" has no location set.',
        'seller', COALESCE(_seller_name, _seller_id::text)
      );
    end if;

    _seller_status_text := _seller_status ->> 'status';

    if _seller_status_text is not null
       and _seller_status_text not in ('open', 'accepting_preorders')
       and not (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;

    if _payment_method = 'cod' then
      _config_accepts_cod := coalesce((_seller_payment_config->>'accepts_cod')::boolean, true);
      if not _config_accepts_cod then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    elsif _payment_method = 'online' then
      _config_accepts_online := coalesce((_seller_payment_config->>'accepts_online')::boolean, true);
      if not _config_accepts_online then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    end if;

    if coalesce(_fulfillment_type, 'delivery') <> 'self_pickup' then
      if not public.buyer_coordinates_are_valid(_delivery_lat, _delivery_lng) then
        return json_build_object(
          'success', false,
          'error', 'buyer_location',
          'message', 'Your selected address has no location coordinates. Please update it with a precise location.'
        );
      end if;
      if _seller_lat is null or _seller_lng is null
         or _seller_radius is null or _seller_radius <= 0
         or not public.seller_is_eligible_for_discovery(_seller_id) then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
      _distance := 6371 * acos(
        least(1.0, cos(radians(_seller_lat)) * cos(radians(_delivery_lat))
        * cos(radians(_delivery_lng) - radians(_seller_lng))
        + sin(radians(_seller_lat)) * sin(radians(_delivery_lat)))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    elsif not public.seller_is_eligible_for_discovery(_seller_id) then
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;

    _group_count := _group_count + 1;
    _order_id := gen_random_uuid();
    _total := 0;

    if _idempotency_key is not null then
      _row_idempotency_key := _idempotency_key || ':' || _group_count;
    else
      _row_idempotency_key := null;
    end if;

    if _seller_status_text = 'accepting_preorders'
       or (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;

    IF _fulfillment_type = 'self_pickup' THEN
      _delivery_handled_by := NULL;
    ELSIF _fulfillment_type = 'delivery' THEN
      IF _seller_fulfillment_mode IN ('seller_delivery', 'pickup_and_seller_delivery') THEN
        _delivery_handled_by := 'seller';
      ELSIF _seller_fulfillment_mode IN ('platform_delivery', 'pickup_and_platform_delivery') THEN
        _delivery_handled_by := 'platform';
      ELSIF _delivery_handled_by IS NULL THEN
        _delivery_handled_by := 'seller';
      END IF;
    END IF;

    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );

    IF NOT public.seller_credit_activation_satisfied(_seller_id) THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    _credit_gate := public.seller_credit_can_accept(_seller_id, 'ORDER_COMPLETED');
    IF COALESCE((_credit_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    insert into public.orders (
      id, buyer_id, seller_id, total_amount, status, order_type, notes,
      fulfillment_type, delivery_address, delivery_address_id,
      delivery_lat, delivery_lng,
      payment_type, payment_status, delivery_fee, packaging_fee, coupon_discount, discount_amount, coupon_id,
      idempotency_key, delivery_handled_by, auto_cancel_at,
      scheduled_date, scheduled_time_start,
      transaction_type,
      loyalty_discount_amount, loyalty_points_redeemed
    ) values (
      -- Newer clients send each store its own notes so one store never sees another store's add-ons.
      _order_id, _buyer_id, _seller_id, 0, _effective_status::public.order_status, 'purchase',
      case when (_seller_group::jsonb) ? 'notes' then nullif(btrim(_seller_group->>'notes'), '') else _notes end,
      _fulfillment_type, _delivery_address, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _payment_method, _payment_status,
      case when _group_count = 1 then _delivery_fee else 0 end,
      coalesce(_packaging_fee, 0),
      case when _group_count = 1 then _coupon_discount else 0 end,
      case when _group_count = 1 then coalesce(_coupon_discount, 0) else 0 end,
      case when _group_count = 1 then _resolved_coupon_id else null end,
      _row_idempotency_key, _delivery_handled_by, _auto_cancel_at,
      _effective_scheduled_date::date, _effective_scheduled_time::time,
      COALESCE(_resolved_tx_type, 'cart_purchase'),
      0, 0
    );

    if _first_order_id is null then
      _first_order_id := _order_id;
    end if;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _variant_id := NULLIF(_item->>'variant_id', '')::uuid;

      SELECT
        COALESCE((_item->>'product_name'), p.name, 'Unknown Product'),
        COALESCE((_item->>'product_image'), p.image_url)
      INTO _resolved_product_name, _resolved_product_image
      FROM public.products p
      WHERE p.id = _product_id;

      IF _resolved_product_name IS NULL THEN
        _resolved_product_name := COALESCE((_item->>'product_name'), 'Unknown Product');
      END IF;

      _resolved_variant_label := null;
      if _variant_id is not null then
        select pv.label, coalesce(pv.image_url, p.image_url, _resolved_product_image),
               coalesce(p.name, _resolved_product_name) || ' (' || pv.label || ')'
          into _resolved_variant_label, _resolved_product_image, _resolved_product_name
        from public.product_variants pv
        join public.products p on p.id = pv.product_id
        where pv.id = _variant_id;
      end if;

      insert into public.order_items (
        order_id, product_id, variant_id, variant_label, quantity, unit_price, subtotal, product_name, product_image,
        selected_extras
      ) values (
        _order_id,
        _product_id,
        _variant_id,
        _resolved_variant_label,
        (_item->>'quantity')::int,
        (_item->>'unit_price')::numeric,
        ((_item->>'quantity')::int * (_item->>'unit_price')::numeric),
        _resolved_product_name,
        _resolved_product_image,
        case when json_typeof(_item->'selected_extras') = 'array' then (_item->'selected_extras')::jsonb else '[]'::jsonb end
      );
      _total := _total + ((_item->>'quantity')::int * (_item->>'unit_price')::numeric);
    end loop;

    update public.orders
    set total_amount = _total
        + (case when _group_count = 1 then _delivery_fee else 0 end)
        + coalesce(_packaging_fee, 0)
        - (case when _group_count = 1 then _coupon_discount else 0 end)
    where id = _order_id;

    _order_ids := array_append(_order_ids, _order_id);
  end loop;

  _created_count := coalesce(array_length(_order_ids, 1), 0);

  if _total_groups > 1 and _created_count > 0 and _created_count < _total_groups then
    delete from public.orders where id = any(_order_ids);
    _skipped_sellers := _closed_sellers || _out_of_range || _payment_blocked_sellers || _credit_blocked_sellers;
    return json_build_object(
      'success', false,
      'error', 'partial_checkout_blocked',
      'message', 'Checkout cannot complete for all stores in your cart. Remove unavailable stores or order from each store separately.',
      'skipped_sellers', to_json(_skipped_sellers),
      'closed_sellers', to_json(_closed_sellers),
      'out_of_range_sellers', to_json(_out_of_range),
      'payment_blocked_sellers', to_json(_payment_blocked_sellers),
      'credit_blocked_sellers', to_json(_credit_blocked_sellers),
      'created_count', _created_count,
      'total_groups', _total_groups
    );
  end if;

  if array_length(_closed_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object('success', false, 'error', 'sellers_closed', 'sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 and _created_count = 0 then
    return json_build_object('success', false, 'error', 'out_of_range', 'sellers', to_json(_out_of_range));
  end if;

  if array_length(_payment_blocked_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object(
      'success', false,
      'error', 'payment_method_not_accepted',
      'sellers', to_json(_payment_blocked_sellers),
      'message', 'Selected payment method is not accepted by: ' || array_to_string(_payment_blocked_sellers, ', ')
    );
  end if;

  if array_length(_credit_blocked_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object(
      'success', false,
      'error', 'credit_blocked',
      'sellers', to_json(_credit_blocked_sellers),
      'message', 'This seller is currently unavailable for new orders.'
    );
  end if;

  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
    values (_resolved_coupon_id, _buyer_id, _first_order_id, _coupon_discount);

    update public.coupons
    set times_used = times_used + 1
    where id = _resolved_coupon_id;
  end if;

  if coalesce(_loyalty_points, 0) > 0 and _created_count > 0 then
    _loyalty_result := public.apply_loyalty_to_checkout_orders(
      _buyer_id,
      _order_ids,
      _loyalty_points,
      _payment_method,
      _idempotency_key
    );
    if coalesce((_loyalty_result->>'success')::boolean, false) is not true then
      raise exception 'loyalty_apply_failed: %', coalesce(_loyalty_result->>'error', 'unknown')
        using errcode = 'P0001';
    end if;
  end if;

  if coalesce(_wallet_amount, 0) > 0 and _created_count > 0 then
    _wallet_result := public.apply_wallet_to_checkout_orders(
      _buyer_id,
      _order_ids,
      _wallet_amount,
      _payment_method,
      _idempotency_key
    );
    if coalesce((_wallet_result->>'success')::boolean, false) is not true then
      raise exception 'wallet_apply_failed: %', coalesce(_wallet_result->>'error', 'unknown')
        using errcode = 'P0001';
    end if;
  end if;

  if _created_count > 0 then
    for _product_id, _client_qty in
      select oi.product_id, sum(oi.quantity)::int
      from public.order_items oi
      where oi.order_id = any (_order_ids)
        and oi.variant_id is null
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

    for _variant_id, _client_qty in
      select oi.variant_id, sum(oi.quantity)::int
      from public.order_items oi
      where oi.order_id = any (_order_ids)
        and oi.variant_id is not null
      group by oi.variant_id
    loop
      select stock_quantity is not null into _tracks_stock
      from public.product_variants where id = _variant_id;

      if coalesce(_tracks_stock, false) then
        update public.product_variants
        set stock_quantity = stock_quantity - _client_qty
        where id = _variant_id
          and stock_quantity is not null
          and stock_quantity >= _client_qty;

        get diagnostics _stock_rows = row_count;
        if _stock_rows = 0 then
          raise exception 'insufficient_stock for variant %', _variant_id
            using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'loyalty', _loyalty_result,
    'wallet', _wallet_result
  );
end;
$function$;
