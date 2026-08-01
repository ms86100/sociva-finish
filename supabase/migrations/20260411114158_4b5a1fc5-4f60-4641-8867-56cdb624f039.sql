
-- Step 1: Fix category constraint
ALTER TABLE public.dispute_tickets
DROP CONSTRAINT IF EXISTS dispute_tickets_category_check;

ALTER TABLE public.dispute_tickets
ADD CONSTRAINT dispute_tickets_category_check
CHECK (category IN (
  'quality', 'delivery', 'payment', 'behaviour', 'other',
  'noise', 'parking', 'pet', 'maintenance'
));

-- Step 2: Add missing is_anonymous column
ALTER TABLE public.dispute_tickets
ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

-- Step 3: Seed dispute_categories_json into system_settings
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'dispute_categories_json',
  '[{"value":"noise","label":"Noise"},{"value":"parking","label":"Parking"},{"value":"pet","label":"Pet Related"},{"value":"maintenance","label":"Maintenance"},{"value":"quality","label":"Quality Issue"},{"value":"delivery","label":"Delivery Issue"},{"value":"payment","label":"Payment Issue"},{"value":"behaviour","label":"Behaviour"},{"value":"other","label":"Other"}]',
  'Allowed dispute ticket categories shown in UI'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
