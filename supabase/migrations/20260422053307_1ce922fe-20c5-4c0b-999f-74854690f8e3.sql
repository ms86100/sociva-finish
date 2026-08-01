
-- Atomic save: insert product + optional service_listings in one transaction
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
BEGIN
  v_seller_id := (p_product->>'seller_id')::uuid;

  -- Ownership check: caller must own the seller profile
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE id = v_seller_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to create products for this seller';
  END IF;

  -- Insert product (jsonb_populate_record maps keys to columns)
  INSERT INTO public.products
  SELECT * FROM jsonb_populate_record(NULL::public.products, p_product)
  RETURNING id INTO v_product_id;

  -- Optionally insert service listing in same txn
  IF p_service IS NOT NULL THEN
    INSERT INTO public.service_listings (
      product_id, service_type, location_type, duration_minutes,
      buffer_minutes, max_bookings_per_slot, cancellation_notice_hours,
      rescheduling_notice_hours, preparation_instructions
    ) VALUES (
      v_product_id,
      COALESCE(p_service->>'service_type', 'scheduled'),
      COALESCE(p_service->>'location_type', 'at_seller'),
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

-- Atomic update: update product + upsert service_listings in one transaction
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
BEGIN
  -- Ownership check: caller must own the seller for this product
  SELECT p.seller_id INTO v_seller_id FROM public.products p WHERE p.id = p_product_id;
  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE id = v_seller_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to update this product';
  END IF;

  -- Update product columns from jsonb
  UPDATE public.products SET
    name = COALESCE(p_product->>'name', name),
    description = CASE WHEN p_product ? 'description' THEN p_product->>'description' ELSE description END,
    price = COALESCE((p_product->>'price')::numeric, price),
    mrp = CASE WHEN p_product ? 'mrp' THEN NULLIF(p_product->>'mrp','')::numeric ELSE mrp END,
    prep_time_minutes = CASE WHEN p_product ? 'prep_time_minutes' THEN NULLIF(p_product->>'prep_time_minutes','')::int ELSE prep_time_minutes END,
    category = COALESCE(p_product->>'category', category),
    is_veg = COALESCE((p_product->>'is_veg')::boolean, is_veg),
    is_available = COALESCE((p_product->>'is_available')::boolean, is_available),
    is_bestseller = COALESCE((p_product->>'is_bestseller')::boolean, is_bestseller),
    is_recommended = COALESCE((p_product->>'is_recommended')::boolean, is_recommended),
    is_urgent = COALESCE((p_product->>'is_urgent')::boolean, is_urgent),
    image_url = CASE WHEN p_product ? 'image_url' THEN p_product->>'image_url' ELSE image_url END,
    action_type = COALESCE(p_product->>'action_type', action_type),
    contact_phone = CASE WHEN p_product ? 'contact_phone' THEN p_product->>'contact_phone' ELSE contact_phone END,
    stock_quantity = CASE WHEN p_product ? 'stock_quantity' THEN NULLIF(p_product->>'stock_quantity','')::int ELSE stock_quantity END,
    low_stock_threshold = COALESCE((p_product->>'low_stock_threshold')::int, low_stock_threshold),
    subcategory_id = CASE WHEN p_product ? 'subcategory_id' THEN NULLIF(p_product->>'subcategory_id','')::uuid ELSE subcategory_id END,
    lead_time_hours = CASE WHEN p_product ? 'lead_time_hours' THEN NULLIF(p_product->>'lead_time_hours','')::int ELSE lead_time_hours END,
    accepts_preorders = COALESCE((p_product->>'accepts_preorders')::boolean, accepts_preorders),
    specifications = CASE WHEN p_product ? 'specifications' THEN p_product->'specifications' ELSE specifications END,
    approval_status = COALESCE(p_product->>'approval_status', approval_status),
    rejection_note = CASE WHEN p_product ? 'rejection_note' THEN p_product->>'rejection_note' ELSE rejection_note END,
    updated_while_pending = COALESCE((p_product->>'updated_while_pending')::boolean, updated_while_pending),
    updated_at = now()
  WHERE id = p_product_id;

  -- Upsert service listing in same txn
  IF p_service IS NOT NULL THEN
    INSERT INTO public.service_listings (
      product_id, service_type, location_type, duration_minutes,
      buffer_minutes, max_bookings_per_slot, cancellation_notice_hours,
      rescheduling_notice_hours, preparation_instructions
    ) VALUES (
      p_product_id,
      COALESCE(p_service->>'service_type', 'scheduled'),
      COALESCE(p_service->>'location_type', 'at_seller'),
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
