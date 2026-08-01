
-- Step 1: Add license columns to category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS requires_license boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS license_type_name text,
  ADD COLUMN IF NOT EXISTS license_description text,
  ADD COLUMN IF NOT EXISTS license_mandatory boolean NOT NULL DEFAULT false;

-- Step 2: Migrate existing data from parent_groups to category_config
UPDATE public.category_config cc
SET
  requires_license = pg.requires_license,
  license_type_name = pg.license_type_name,
  license_description = pg.license_description,
  license_mandatory = pg.license_mandatory
FROM public.parent_groups pg
WHERE cc.parent_group = pg.slug
  AND pg.requires_license = true;

-- Step 3: Add category_config_id to seller_licenses
ALTER TABLE public.seller_licenses
  ADD COLUMN IF NOT EXISTS category_config_id uuid REFERENCES public.category_config(id);

-- Step 4: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_category_config_requires_license ON public.category_config(requires_license) WHERE requires_license = true;
CREATE INDEX IF NOT EXISTS idx_seller_licenses_category_config_id ON public.seller_licenses(category_config_id);
