-- Non-food products must not carry dietary flags.
-- Root cause: normalize_product_hints() forced is_veg := true whenever
-- show_veg_toggle was off, so clothing/services always stored as veg.

CREATE OR REPLACE FUNCTION public.normalize_product_hints()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _show_veg boolean;
  _show_duration boolean;
  _parent_group text;
  _layout_type text;
  _is_food boolean;
BEGIN
  SELECT show_veg_toggle, show_duration_field, parent_group, layout_type
    INTO _show_veg, _show_duration, _parent_group, _layout_type
  FROM public.category_config
  WHERE category = NEW.category;

  _is_food := (
    COALESCE(_show_veg, false)
    OR COALESCE(_parent_group, '') ILIKE '%food%'
    OR COALESCE(_layout_type, '') = 'food'
  );

  -- Dietary flag only for food; never default non-food to veg=true.
  -- pet_food sits under pets but its slug contains "food" — always clear it.
  IF NOT _is_food OR NEW.category = 'pet_food' THEN
    NEW.is_veg := NULL;
  END IF;

  IF _show_duration IS NOT TRUE THEN
    NEW.prep_time_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE public.products ALTER COLUMN is_veg SET DEFAULT NULL;

-- One-time backfill: disable USER triggers so price/category validators
-- do not block clearing dietary flags on legacy rows.
ALTER TABLE public.products DISABLE TRIGGER USER;

UPDATE public.products p
SET is_veg = NULL
WHERE p.is_veg IS NOT NULL
  AND (
    p.category = 'pet_food'
    OR NOT EXISTS (
      SELECT 1
      FROM public.category_config cc
      WHERE cc.category = p.category
        AND (
          COALESCE(cc.show_veg_toggle, false) = true
          OR COALESCE(cc.parent_group, '') ILIKE '%food%'
          OR COALESCE(cc.layout_type, '') = 'food'
        )
        AND cc.category IS DISTINCT FROM 'pet_food'
    )
  );

ALTER TABLE public.products ENABLE TRIGGER USER;
