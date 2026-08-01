
-- 1. Fix resolve_banner_section_products: add verification_status check
CREATE OR REPLACE FUNCTION public.resolve_banner_section_products(
  p_banner_id uuid,
  p_society_id uuid DEFAULT NULL,
  p_buyer_lat double precision DEFAULT NULL,
  p_buyer_lng double precision DEFAULT NULL,
  p_limit_per_section int DEFAULT 20
)
RETURNS TABLE (
  section_id uuid,
  product_id uuid,
  product_name text,
  product_price numeric,
  product_mrp numeric,
  product_image_url text,
  product_category text,
  product_is_veg boolean,
  product_is_available boolean,
  product_is_bestseller boolean,
  product_stock_quantity int,
  product_low_stock_threshold int,
  product_seller_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ranked.section_id,
    ranked.id,
    ranked.name,
    ranked.price,
    ranked.mrp,
    ranked.image_url,
    ranked.category,
    ranked.is_veg,
    ranked.is_available,
    ranked.is_bestseller,
    ranked.stock_quantity,
    ranked.low_stock_threshold,
    ranked.seller_id
  FROM (
    SELECT
      bs.id AS section_id,
      p.id,
      p.name,
      p.price,
      p.mrp,
      p.image_url,
      p.category,
      p.is_veg,
      p.is_available,
      p.is_bestseller,
      p.stock_quantity,
      p.low_stock_threshold,
      p.seller_id,
      ROW_NUMBER() OVER (PARTITION BY bs.id ORDER BY p.is_bestseller DESC, p.price ASC) AS rn
    FROM banner_sections bs
    JOIN products p ON (
      (bs.product_source_type = 'category' AND p.category = bs.product_source_value)
      OR (bs.product_source_type = 'search' AND p.name ILIKE '%' || bs.product_source_value || '%')
      OR (bs.product_source_type = 'manual' AND p.id IN (
        SELECT bsp.product_id FROM banner_section_products bsp WHERE bsp.section_id = bs.id
      ))
    )
    JOIN seller_profiles sp ON sp.id = p.seller_id
    WHERE bs.banner_id = p_banner_id
      AND p.is_available = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.stock_quantity, 0) > 0
      AND sp.is_active = true
      AND sp.verification_status = 'approved'
      -- Seller participation enforcement: require explicit opt-in
      AND EXISTS (
        SELECT 1 FROM festival_seller_participation fsp
        WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = true
      )
      -- Society filtering
      AND (
        p_society_id IS NULL
        OR sp.society_id = p_society_id
        OR (
          sp.sell_beyond_community = true
          AND (
            sp.delivery_radius_km IS NULL
            OR p_buyer_lat IS NULL
            OR p_buyer_lng IS NULL
            OR (
              6371 * acos(
                cos(radians(p_buyer_lat)) * cos(radians(sp.latitude))
                * cos(radians(sp.longitude) - radians(p_buyer_lng))
                + sin(radians(p_buyer_lat)) * sin(radians(sp.latitude))
              ) <= sp.delivery_radius_km
            )
          )
        )
      )
  ) ranked
  WHERE ranked.rn <= p_limit_per_section
  ORDER BY ranked.section_id, ranked.rn;
END;
$$;

-- 2. Update active_banners_for_society to auto-expire stale banners
CREATE OR REPLACE FUNCTION public.active_banners_for_society(p_society_id uuid DEFAULT NULL)
RETURNS SETOF public.featured_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Auto-expire banners past their schedule_end
  UPDATE public.featured_items
  SET status = 'expired', is_active = false
  WHERE schedule_end IS NOT NULL
    AND schedule_end < now()
    AND status = 'published'
    AND is_active = true;

  -- Return active banners
  RETURN QUERY
  SELECT *
  FROM public.featured_items
  WHERE is_active = true
    AND status = 'published'
    AND (schedule_start IS NULL OR schedule_start <= now())
    AND (schedule_end IS NULL OR schedule_end >= now())
    AND (
      p_society_id IS NULL
      OR target_society_ids = '{}'
      OR p_society_id = ANY(target_society_ids)
      OR society_id = p_society_id
      OR society_id IS NULL
    )
  ORDER BY display_order ASC;
END;
$$;

-- 3. Create banner-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('banner-images', 'banner-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to view banner images (public bucket)
CREATE POLICY "Banner images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'banner-images');

-- Only authenticated users can upload banner images
CREATE POLICY "Authenticated users can upload banner images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'banner-images');

-- Only authenticated users can update banner images
CREATE POLICY "Authenticated users can update banner images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'banner-images');

-- Only authenticated users can delete banner images
CREATE POLICY "Authenticated users can delete banner images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'banner-images');
