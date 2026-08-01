-- Add primary_group column to seller_profiles
ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS primary_group TEXT;

-- Create index for faster filtering by primary_group
CREATE INDEX IF NOT EXISTS idx_seller_profiles_primary_group ON seller_profiles(primary_group);

-- Update existing sellers to set primary_group based on their first category
-- This uses a trigger function to derive the group from categories
CREATE OR REPLACE FUNCTION public.get_category_parent_group(cat TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (
    SELECT parent_group FROM public.category_config 
    WHERE category::text = cat 
    LIMIT 1
  );
END;
$$;