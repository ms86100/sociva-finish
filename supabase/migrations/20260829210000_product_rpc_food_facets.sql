-- Persist food facets (tags + cuisine_type) through the seller product RPCs.
-- Columns already exist on products; the RPCs previously dropped them on save.

CREATE OR REPLACE FUNCTION public.save_product_with_service(
  p_product jsonb,
  p_service jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_location_types text[];
  v_location_type text;
BEGIN
  v_seller_id := (p_product->>'seller_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE id = v_seller_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to create products for this seller';
  END IF;

  v_row := jsonb_populate_record(NULL::public.products, p_product);

  INSERT INTO public.products (
    seller_id,
    name,
    description,
    price,
    mrp,
    image_url,
    category,
    is_veg,
    is_available,
    is_bestseller,
    is_recommended,
    is_urgent,
    listing_type,
    prep_time_minutes,
    approval_status,
    action_type,
    contact_phone,
    stock_quantity,
    low_stock_threshold,
    specifications,
    accepts_preorders,
    lead_time_hours,
    subcategory_id,
    updated_while_pending,
    tags,
    cuisine_type
  ) VALUES (
    v_seller_id,
    NULLIF(btrim(COALESCE(v_row.name, '')), ''),
    v_row.description,
    COALESCE(v_row.price, 0),
    v_row.mrp,
    v_row.image_url,
    v_row.category,
    COALESCE(v_row.is_veg, true),
    COALESCE(v_row.is_available, true),
    COALESCE(v_row.is_bestseller, false),
    COALESCE(v_row.is_recommended, false),
    COALESCE(v_row.is_urgent, false),
    COALESCE(v_row.listing_type, 'product'),
    v_row.prep_time_minutes,
    COALESCE(NULLIF(v_row.approval_status, ''), 'draft'),
    COALESCE(NULLIF(v_row.action_type, ''), 'add_to_cart'),
    v_row.contact_phone,
    v_row.stock_quantity,
    COALESCE(v_row.low_stock_threshold, 5),
    v_row.specifications,
    COALESCE(v_row.accepts_preorders, false),
    v_row.lead_time_hours,
    v_row.subcategory_id,
    COALESCE(v_row.updated_while_pending, false),
    v_row.tags,
    v_row.cuisine_type
  )
  RETURNING id INTO v_product_id;

  IF p_service IS NOT NULL THEN
    IF p_service ? 'location_types' AND jsonb_typeof(p_service->'location_types') = 'array' THEN
      SELECT COALESCE(array_agg(elem), ARRAY['at_seller']::text[])
      INTO v_location_types
      FROM jsonb_array_elements_text(p_service->'location_types') AS elem;
    ELSE
      v_location_types := ARRAY[COALESCE(p_service->>'location_type', 'at_seller')];
    END IF;
    v_location_type := v_location_types[1];

    INSERT INTO public.service_listings (
      product_id, service_type, location_type, location_types, duration_minutes,
      buffer_minutes, max_bookings_per_slot, cancellation_notice_hours,
      rescheduling_notice_hours, preparation_instructions
    ) VALUES (
      v_product_id,
      COALESCE(p_service->>'service_type', 'scheduled'),
      v_location_type,
      v_location_types,
      COALESCE((p_service->>'duration_minutes')::int, 60),
      COALESCE((p_service->>'buffer_minutes')::int, 0),
      COALESCE((p_service->>'max_bookings_per_slot')::int, 1),
      COALESCE((p_service->>'cancellation_notice_hours')::int, 24),
      COALESCE((p_service->>'rescheduling_notice_hours')::int, 12),
      NULLIF(p_service->>'preparation_instructions', '')
    );
  END IF;

  RETURN v_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_with_service(
  p_product_id uuid,
  p_product jsonb,
  p_service jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_location_types text[];
  v_location_type text;
BEGIN
  SELECT seller_id INTO v_seller_id FROM public.products WHERE id = p_product_id;
  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE id = v_seller_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to update this product';
  END IF;

  UPDATE public.products SET
    name = COALESCE(NULLIF(p_product->>'name', ''), name),
    description = CASE WHEN p_product ? 'description' THEN p_product->>'description' ELSE description END,
    price = COALESCE((p_product->>'price')::numeric, price),
    mrp = CASE WHEN p_product ? 'mrp' THEN NULLIF(p_product->>'mrp', '')::numeric ELSE mrp END,
    image_url = CASE WHEN p_product ? 'image_url' THEN p_product->>'image_url' ELSE image_url END,
    category = COALESCE(p_product->>'category', category),
    is_veg = COALESCE((p_product->>'is_veg')::boolean, is_veg),
    is_available = COALESCE((p_product->>'is_available')::boolean, is_available),
    is_bestseller = COALESCE((p_product->>'is_bestseller')::boolean, is_bestseller),
    is_recommended = COALESCE((p_product->>'is_recommended')::boolean, is_recommended),
    is_urgent = COALESCE((p_product->>'is_urgent')::boolean, is_urgent),
    listing_type = COALESCE(p_product->>'listing_type', listing_type),
    prep_time_minutes = CASE WHEN p_product ? 'prep_time_minutes' THEN NULLIF(p_product->>'prep_time_minutes', '')::int ELSE prep_time_minutes END,
    action_type = COALESCE(p_product->>'action_type', action_type),
    contact_phone = CASE WHEN p_product ? 'contact_phone' THEN p_product->>'contact_phone' ELSE contact_phone END,
    stock_quantity = CASE WHEN p_product ? 'stock_quantity' THEN NULLIF(p_product->>'stock_quantity', '')::int ELSE stock_quantity END,
    low_stock_threshold = CASE WHEN p_product ? 'low_stock_threshold' THEN NULLIF(p_product->>'low_stock_threshold', '')::int ELSE low_stock_threshold END,
    subcategory_id = CASE WHEN p_product ? 'subcategory_id' THEN NULLIF(p_product->>'subcategory_id','')::uuid ELSE subcategory_id END,
    lead_time_hours = CASE WHEN p_product ? 'lead_time_hours' THEN NULLIF(p_product->>'lead_time_hours','')::numeric ELSE lead_time_hours END,
    accepts_preorders = COALESCE((p_product->>'accepts_preorders')::boolean, accepts_preorders),
    specifications = CASE WHEN p_product ? 'specifications' THEN p_product->'specifications' ELSE specifications END,
    approval_status = COALESCE(p_product->>'approval_status', approval_status),
    rejection_note = CASE WHEN p_product ? 'rejection_note' THEN p_product->>'rejection_note' ELSE rejection_note END,
    updated_while_pending = COALESCE((p_product->>'updated_while_pending')::boolean, updated_while_pending),
    tags = CASE
      WHEN p_product ? 'tags' AND jsonb_typeof(p_product->'tags') = 'array' THEN
        COALESCE((SELECT array_agg(elem) FROM jsonb_array_elements_text(p_product->'tags') AS elem), ARRAY[]::text[])
      WHEN p_product ? 'tags' THEN ARRAY[]::text[]
      ELSE tags
    END,
    cuisine_type = CASE WHEN p_product ? 'cuisine_type' THEN NULLIF(p_product->>'cuisine_type','') ELSE cuisine_type END,
    updated_at = now()
  WHERE id = p_product_id;

  IF p_service IS NOT NULL THEN
    IF p_service ? 'location_types' AND jsonb_typeof(p_service->'location_types') = 'array' THEN
      SELECT COALESCE(array_agg(elem), ARRAY['at_seller']::text[])
      INTO v_location_types
      FROM jsonb_array_elements_text(p_service->'location_types') AS elem;
    ELSE
      v_location_types := ARRAY[COALESCE(p_service->>'location_type', 'at_seller')];
    END IF;
    v_location_type := v_location_types[1];

    INSERT INTO public.service_listings (
      product_id, service_type, location_type, location_types, duration_minutes,
      buffer_minutes, max_bookings_per_slot, cancellation_notice_hours,
      rescheduling_notice_hours, preparation_instructions
    ) VALUES (
      p_product_id,
      COALESCE(p_service->>'service_type', 'scheduled'),
      v_location_type,
      v_location_types,
      COALESCE((p_service->>'duration_minutes')::int, 60),
      COALESCE((p_service->>'buffer_minutes')::int, 0),
      COALESCE((p_service->>'max_bookings_per_slot')::int, 1),
      COALESCE((p_service->>'cancellation_notice_hours')::int, 24),
      COALESCE((p_service->>'rescheduling_notice_hours')::int, 12),
      NULLIF(p_service->>'preparation_instructions', '')
    )
    ON CONFLICT (product_id) DO UPDATE SET
      service_type = EXCLUDED.service_type,
      location_type = EXCLUDED.location_type,
      location_types = EXCLUDED.location_types,
      duration_minutes = EXCLUDED.duration_minutes,
      buffer_minutes = EXCLUDED.buffer_minutes,
      max_bookings_per_slot = EXCLUDED.max_bookings_per_slot,
      cancellation_notice_hours = EXCLUDED.cancellation_notice_hours,
      rescheduling_notice_hours = EXCLUDED.rescheduling_notice_hours,
      preparation_instructions = EXCLUDED.preparation_instructions,
      updated_at = now();
  END IF;

  RETURN p_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_product_with_service(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_with_service(uuid, jsonb, jsonb) TO authenticated;
