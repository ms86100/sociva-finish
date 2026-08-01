
-- 1. Add multi-society targeting column
ALTER TABLE public.featured_items
ADD COLUMN target_society_ids uuid[] NOT NULL DEFAULT '{}';

-- 2. Backfill from existing society_id
UPDATE public.featured_items
SET target_society_ids = ARRAY[society_id]
WHERE society_id IS NOT NULL;

-- 3. GIN index for array containment queries
CREATE INDEX idx_featured_items_target_societies
ON public.featured_items USING GIN (target_society_ids);

-- 4. Composite indexes for the RPC join performance
CREATE INDEX IF NOT EXISTS idx_seller_profiles_banner_lookup
ON public.seller_profiles (society_id, is_available, verification_status);

CREATE INDEX IF NOT EXISTS idx_products_banner_lookup
ON public.products (category, approval_status, is_available);

-- 5. Core RPC: resolve_banner_products
CREATE OR REPLACE FUNCTION public.resolve_banner_products(
  p_mode text,
  p_value text,
  p_society_id uuid,
  p_buyer_lat double precision DEFAULT NULL,
  p_buyer_lng double precision DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  price numeric,
  mrp numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  is_bestseller boolean,
  stock_quantity integer,
  low_stock_threshold integer,
  seller_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
BEGIN
  -- Look up society coordinates if a society is targeted
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude
    INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = p_society_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.price,
    p.mrp,
    p.image_url,
    p.category::text,
    p.is_veg,
    p.is_available,
    p.is_bestseller,
    p.stock_quantity,
    p.low_stock_threshold,
    p.seller_id
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE
    -- Product eligibility
    p.is_available = true
    AND p.approval_status = 'approved'
    AND p.stock_quantity > 0
    -- Seller eligibility
    AND sp.is_available = true
    AND sp.verification_status = 'approved'
    -- Society eligibility (3-way)
    AND (
      p_society_id IS NULL                          -- global: no society filter
      OR sp.society_id = p_society_id               -- local resident seller
      OR (
        sp.society_id IS DISTINCT FROM p_society_id -- cross-society OR commercial
        AND (sp.society_id IS NULL OR sp.sell_beyond_community = true)
        AND sp.latitude IS NOT NULL AND _society_lat IS NOT NULL
        AND public.haversine_km(sp.latitude, sp.longitude, _society_lat, _society_lng)
            <= COALESCE(sp.delivery_radius_km, 0)
      )
    )
    -- Buyer-level radius check (when coordinates provided)
    AND (
      p_buyer_lat IS NULL OR p_buyer_lng IS NULL
      OR sp.latitude IS NULL OR sp.longitude IS NULL
      OR public.haversine_km(sp.latitude, sp.longitude, p_buyer_lat, p_buyer_lng)
          <= COALESCE(sp.delivery_radius_km, 0)
    )
    -- Mode-specific filters
    AND (
      CASE p_mode
        WHEN 'category' THEN p.category::text = p_value
        WHEN 'search' THEN p.search_vector @@ plainto_tsquery('english', COALESCE(p_value, ''))
        WHEN 'popular' THEN p.is_bestseller = true
        ELSE true
      END
    )
  ORDER BY
    (p.stock_quantity > 0)::int DESC,
    p.is_bestseller DESC,
    p.is_recommended DESC,
    p.price ASC
  LIMIT p_limit;
END;
$$;

-- 6. Update RLS SELECT policy for target_society_ids
DROP POLICY IF EXISTS "Anyone can view active featured items in their society" ON public.featured_items;

CREATE POLICY "Anyone can view active featured items in their society"
ON public.featured_items
FOR SELECT
USING (
  (
    is_active = true
    AND (
      -- Global banner (empty array or null society_id)
      target_society_ids = '{}'
      -- OR user's society is in the target list
      OR get_user_society_id(auth.uid()) = ANY(target_society_ids)
      -- Backward compat: old society_id column
      OR society_id IS NULL
      OR society_id = get_user_society_id(auth.uid())
    )
  )
  OR is_admin(auth.uid())
);
