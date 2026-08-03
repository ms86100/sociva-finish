-- Remap category_config off deactivated legacy parent groups (DEF-002 follow-up)
UPDATE public.category_config
SET parent_group = 'education_learning', updated_at = now()
WHERE parent_group = 'classes';

UPDATE public.category_config
SET parent_group = 'food_beverages', updated_at = now()
WHERE parent_group = 'food';

UPDATE public.category_config
SET parent_group = 'personal_care', updated_at = now()
WHERE parent_group = 'personal';

UPDATE public.category_config
SET parent_group = 'home_services', updated_at = now()
WHERE parent_group = 'services';
