-- jsonb_populate_record() fills missing columns with NULL. INSERT ... SELECT *
-- then writes that NULL into products.id and skips DEFAULT gen_random_uuid(),
-- so Add Product fails with a not-null constraint. Insert named columns only
-- so id / timestamps / search_vector keep their defaults and triggers.

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
    updated_while_pending
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
    COALESCE(v_row.updated_while_pending, false)
  )
  RETURNING id INTO v_product_id;

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

GRANT EXECUTE ON FUNCTION public.save_product_with_service(jsonb, jsonb) TO authenticated;
