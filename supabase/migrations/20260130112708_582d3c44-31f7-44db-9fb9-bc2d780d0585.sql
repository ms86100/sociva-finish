-- Phase 1: Multi-Seller Support - Drop unique constraint and add composite constraint
-- This allows users to have multiple seller profiles in different primary_groups

-- Step 1: Drop the existing unique constraint on user_id
ALTER TABLE public.seller_profiles DROP CONSTRAINT IF EXISTS seller_profiles_user_id_key;

-- Step 2: Add composite unique constraint (one business per category group per user)
ALTER TABLE public.seller_profiles ADD CONSTRAINT seller_profiles_user_group_key 
  UNIQUE (user_id, primary_group);

-- Phase 2: Enhanced Search - Create search function for marketplace
CREATE OR REPLACE FUNCTION public.search_marketplace(search_term text)
RETURNS TABLE (
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
  availability_start time,
  availability_end time,
  user_id uuid,
  matching_products jsonb
) 
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
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