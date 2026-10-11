-- The cafe category slug was showing with an underscore. Keep one cart
-- category named cafe, and point the existing catalogue at it.

UPDATE public.category_config
SET category = 'cafe',
    display_name = 'Cafe'
WHERE category = 'cafes_coffee'
  AND NOT EXISTS (
    SELECT 1 FROM public.category_config existing WHERE existing.category = 'cafe'
  );

UPDATE public.seller_profiles
SET categories = array_replace(categories, 'cafes_coffee', 'cafe')
WHERE 'cafes_coffee' = ANY(categories);

UPDATE public.products
SET category = 'cafe'
WHERE category = 'cafes_coffee';
