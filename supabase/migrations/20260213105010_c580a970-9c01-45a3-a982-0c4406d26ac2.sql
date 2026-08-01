
-- Add FSSAI number to seller_profiles
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS fssai_number text DEFAULT NULL;

-- Update search_marketplace function to filter by society_id
CREATE OR REPLACE FUNCTION public.search_marketplace(search_term text, user_society_id uuid DEFAULT NULL)
RETURNS TABLE(
  seller_id uuid, 
  business_name text, 
  description text, 
  cover_image_url text, 
  profile_image_url text, 
  rating numeric, 
  total_reviews integer, 
  categories text[], 
  primary_group text, 
  is_available boolean, 
  is_featured boolean, 
  availability_start time without time zone, 
  availability_end time without time zone, 
  user_id uuid, 
  matching_products jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    sp.id as seller_id,
    sp.business_name,
    sp.description,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.rating,
    sp.total_reviews,
    sp.categories,
    sp.primary_group,
    sp.is_available,
    sp.is_featured,
    sp.availability_start,
    sp.availability_end,
    sp.user_id,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 
        'name', p.name, 
        'price', p.price,
        'image_url', p.image_url,
        'category', p.category,
        'is_veg', p.is_veg
      ))
      FROM products p
      WHERE p.seller_id = sp.id 
        AND p.is_available = true
        AND (
          p.name ILIKE '%' || search_term || '%' 
          OR p.description ILIKE '%' || search_term || '%'
        )
    ) as matching_products
  FROM seller_profiles sp
  LEFT JOIN products p ON p.seller_id = sp.id AND p.is_available = true
  WHERE sp.verification_status = 'approved'
    AND (user_society_id IS NULL OR sp.society_id = user_society_id)
    AND (
      sp.business_name ILIKE '%' || search_term || '%'
      OR sp.description ILIKE '%' || search_term || '%'
      OR p.name ILIKE '%' || search_term || '%'
      OR p.description ILIKE '%' || search_term || '%'
    )
  GROUP BY sp.id, sp.business_name, sp.description, sp.cover_image_url, 
           sp.profile_image_url, sp.rating, sp.total_reviews, sp.categories,
           sp.primary_group, sp.is_available, sp.is_featured, 
           sp.availability_start, sp.availability_end, sp.user_id
  ORDER BY sp.is_featured DESC, sp.rating DESC;
END;
$$;
