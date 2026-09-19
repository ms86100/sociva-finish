-- Food diet toggle + curated is_veg backfill (no free-text diet matching).
-- Enable seller Veg/Non-Veg control for food_beverages.
-- Backfill only products whose name/tags already encode NonVeg/Egg/Chicken/Mutton/Kebab.

UPDATE public.category_config
SET show_veg_toggle = true
WHERE parent_group = 'food_beverages'
  AND show_veg_toggle IS DISTINCT FROM true;

UPDATE public.subcategories s
SET show_veg_toggle = true
FROM public.category_config cc
WHERE s.category_config_id = cc.id
  AND cc.parent_group = 'food_beverages'
  AND s.show_veg_toggle IS DISTINCT FROM true;

UPDATE public.products p
SET is_veg = false
FROM public.category_config cc
WHERE p.category = cc.category
  AND cc.parent_group = 'food_beverages'
  AND p.is_veg IS DISTINCT FROM false
  AND (
    p.name ~* '\y(non[\s-]*veg|nonveg|chicken|mutton|kebab|seekh)\y'
    OR p.name ~* '\yeggs?\y'
    OR EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p.tags, '{}'::text[])) AS t(tag)
      WHERE t.tag ~* '\y(non[\s-]*veg|nonveg|chicken|mutton|kebab|seekh|eggs?)\y'
    )
  );
