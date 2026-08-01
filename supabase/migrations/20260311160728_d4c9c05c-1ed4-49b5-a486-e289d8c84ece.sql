
-- 1. Enum for seller type
DO $$ BEGIN
  CREATE TYPE public.seller_type_enum AS ENUM ('society_resident', 'commercial');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add columns to seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS seller_type public.seller_type_enum NOT NULL DEFAULT 'society_resident',
  ADD COLUMN IF NOT EXISTS store_location_source text;

-- 3. Index for bounding-box pre-filter
CREATE INDEX IF NOT EXISTS idx_seller_coords ON public.seller_profiles(latitude, longitude);

-- 4. Backfill existing sellers with society coordinates
UPDATE public.seller_profiles sp
SET latitude = s.latitude::double precision,
    longitude = s.longitude::double precision,
    store_location_source = 'society'
FROM public.societies s
WHERE s.id = sp.society_id
  AND s.latitude IS NOT NULL
  AND sp.latitude IS NULL;

-- 5. New RPC: set_my_store_coordinates
CREATE OR REPLACE FUNCTION public.set_my_store_coordinates(
  p_lat double precision, p_lng double precision, p_source text DEFAULT 'manual'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.seller_profiles
  SET latitude = p_lat, longitude = p_lng,
      store_location_source = p_source
  WHERE user_id = auth.uid();
END; $$;

-- 6. Update set_my_society_coordinates to also sync seller_profiles
CREATE OR REPLACE FUNCTION public.set_my_society_coordinates(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _society_id uuid; _found boolean;
BEGIN
  SELECT society_id, true INTO _society_id, _found
  FROM seller_profiles WHERE user_id = auth.uid() LIMIT 1;
  
  IF NOT COALESCE(_found, false) THEN
    RAISE EXCEPTION 'No seller profile found';
  END IF;
  
  IF _society_id IS NULL THEN
    RAISE EXCEPTION 'No society assigned to your seller profile. Please update your store settings first.';
  END IF;
  
  UPDATE societies SET latitude = p_lat, longitude = p_lng
  WHERE id = _society_id AND latitude IS NULL AND longitude IS NULL;

  -- Also sync to seller_profiles for coordinate-first discovery
  UPDATE seller_profiles
  SET latitude = p_lat, longitude = p_lng, store_location_source = 'society'
  WHERE user_id = auth.uid() AND latitude IS NULL;
END; $function$;

-- 7. Recreate search_sellers_by_location with LEFT JOIN + COALESCE + bounding box
CREATE OR REPLACE FUNCTION public.search_sellers_by_location(
  _lat double precision, _lng double precision,
  _radius_km double precision DEFAULT 5,
  _search_term text DEFAULT NULL::text,
  _category text DEFAULT NULL::text,
  _exclude_society_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  seller_id uuid, user_id uuid, business_name text, description text,
  categories text[], primary_group text, cover_image_url text, profile_image_url text,
  is_available boolean, is_featured boolean, rating numeric, total_reviews integer,
  matching_products json, distance_km double precision, society_name text,
  availability_start time without time zone, availability_end time without time zone,
  seller_latitude double precision, seller_longitude double precision
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta_lat double precision;
  _box_delta_lng double precision;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;

  _box_delta_lat := _radius_km * 0.009;
  _box_delta_lng := _radius_km * 0.009;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.user_id,
    sp.business_name,
    sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category,
        'is_veg', p.is_veg, 'action_type', p.action_type,
        'contact_phone', p.contact_phone, 'mrp', p.mrp,
        'discount_percentage', p.discount_percentage
      ))
      FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
      ), '[]'::json
    ) AS matching_products,
    public.haversine_km(_lat, _lng,
      COALESCE(sp.latitude, s.latitude::double precision),
      COALESCE(sp.longitude, s.longitude::double precision)
    ) AS distance_km,
    s.name AS society_name,
    sp.availability_start,
    sp.availability_end,
    COALESCE(sp.latitude, s.latitude::double precision) AS seller_latitude,
    COALESCE(sp.longitude, s.longitude::double precision) AS seller_longitude
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s
    ON s.id = sp.society_id
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    -- Coordinate NULL guard
    AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
    AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
    -- Bounding box pre-filter
    AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta_lat) AND (_lat + _box_delta_lat)
    AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta_lng) AND (_lng + _box_delta_lng)
    -- Precise haversine
    AND public.haversine_km(_lat, _lng,
        COALESCE(sp.latitude, s.latitude::double precision),
        COALESCE(sp.longitude, s.longitude::double precision)
      ) <= LEAST(_radius_km, COALESCE(sp.delivery_radius_km, _radius_km))
    -- Exclude society filter
    AND (_exclude_society_id IS NULL OR sp.society_id IS NULL OR sp.society_id != _exclude_society_id)
    -- Community gating: commercial sellers bypass entirely
    AND (
      sp.seller_type = 'commercial'
      OR sp.sell_beyond_community = true
      OR sp.society_id = (SELECT p2.society_id FROM public.profiles p2 WHERE p2.id = auth.uid())
    )
    -- Must have at least one matching product
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    )
    -- Search filter
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%'
      OR EXISTS (SELECT 1 FROM public.products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.name ILIKE '%' || _search_term || '%'))
  ORDER BY public.haversine_km(_lat, _lng,
    COALESCE(sp.latitude, s.latitude::double precision),
    COALESCE(sp.longitude, s.longitude::double precision)
  );
END;
$function$;

-- 8. Update get_location_stats with LEFT JOIN + COALESCE + bounding box
CREATE OR REPLACE FUNCTION public.get_location_stats(_lat double precision, _lng double precision, _radius_km double precision DEFAULT 5)
 RETURNS TABLE(sellers_count bigint, orders_today bigint, societies_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
BEGIN
  _box_delta := _radius_km * 0.009;

  RETURN QUERY
  WITH nearby_sellers AS (
    SELECT sp.id AS seller_id, sp.society_id
    FROM public.seller_profiles sp
    LEFT JOIN public.societies s
      ON s.id = sp.society_id
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL
    WHERE sp.verification_status = 'approved'
      AND sp.is_available = true
      AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
      AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
      AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      AND public.haversine_km(_lat, _lng,
          COALESCE(sp.latitude, s.latitude::double precision),
          COALESCE(sp.longitude, s.longitude::double precision)
        ) <= _radius_km
  )
  SELECT
    (SELECT COUNT(*) FROM nearby_sellers)::bigint,
    (SELECT COUNT(*)
     FROM public.orders o
     WHERE o.seller_id IN (SELECT ns.seller_id FROM nearby_sellers ns)
       AND o.created_at > now() - interval '24 hours'
       AND o.status NOT IN ('cancelled')
    )::bigint,
    (SELECT COUNT(DISTINCT ns.society_id) FROM nearby_sellers ns WHERE ns.society_id IS NOT NULL)::bigint;
END;
$function$;

-- 9. Update create_multi_vendor_orders delivery radius check to use COALESCE
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _delivery_address text, _notes text, _payment_method text, _payment_status text, _cart_total numeric, _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text, _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false, _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'delivery'::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision)
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
  _seller_status jsonb;
  _seller_status_text text;
  _closed_sellers text[] := '{}';
  _seller_lat double precision;
  _seller_lng double precision;
  _seller_radius double precision;
  _distance double precision;
  _out_of_range text[] := '{}';
begin
  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  -- Pre-validate all sellers
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           public.compute_store_status(
             sp.availability_start,
             sp.availability_end,
             sp.operating_days,
             coalesce(sp.is_available, true)
           ),
           COALESCE(sp.latitude, s.latitude::double precision),
           COALESCE(sp.longitude, s.longitude::double precision),
           sp.delivery_radius_km
      into _seller_name, _seller_status, _seller_lat, _seller_lng, _seller_radius
    from public.seller_profiles sp
    LEFT JOIN public.societies s ON s.id = sp.society_id
    where sp.id = _seller_id;

    if _seller_status is null then
      return json_build_object('success', false, 'error', 'seller_not_found', 'seller_id', _seller_id);
    end if;

    _seller_status_text := coalesce(_seller_status->>'status', 'closed');
    if _seller_status_text <> 'open' then
      _closed_sellers := array_append(_closed_sellers, coalesce(_seller_name, 'Seller'));
    end if;

    -- Delivery radius check
    if _fulfillment_type = 'delivery'
       and _delivery_lat is not null and _delivery_lng is not null
       and _seller_lat is not null and _seller_lng is not null
       and _seller_radius is not null then
      _distance := public.haversine_km(_delivery_lat, _delivery_lng, _seller_lat, _seller_lng);
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range,
          coalesce(_seller_name, 'Seller') || ' (' || round(_distance::numeric, 1) || ' km away, max ' || _seller_radius || ' km)');
      end if;
    end if;
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'closed_sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'out_of_range_sellers', to_json(_out_of_range));
  end if;

  -- Create orders
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
    end loop;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes, order_type, fulfillment_type,
      delivery_address_id, delivery_lat, delivery_lng
    )
    values (
      _order_id, _buyer_id, (_seller_group->>'seller_id')::uuid, _society_id,
      'placed', _total, _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type,
      _delivery_address_id, _delivery_lat, _delivery_lng
    );

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
      values (_order_id, (_item->>'product_id')::uuid, _item->>'product_name', (_item->>'quantity')::int, (_item->>'unit_price')::numeric);
    end loop;

    select sp.user_id into _seller_user_id
    from public.seller_profiles sp where sp.id = (_seller_group->>'seller_id')::uuid;

    if _seller_user_id is not null then
      insert into public.notification_queue (user_id, type, title, body, reference_path, payload)
      values (_seller_user_id, 'order', '🆕 New Order Received!',
        coalesce(_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
        '/orders/' || _order_id::text,
        jsonb_build_object('orderId', _order_id::text, 'status', 'placed', 'type', 'order'));
    end if;

    _order_ids := _order_ids || _order_id;
  end loop;

  delete from public.cart_items where user_id = _buyer_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$;
