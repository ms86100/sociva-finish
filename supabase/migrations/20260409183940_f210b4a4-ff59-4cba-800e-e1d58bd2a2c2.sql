-- expense_flags: add missing columns
ALTER TABLE public.expense_flags ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;
ALTER TABLE public.expense_flags ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- featured_items: add missing columns
ALTER TABLE public.featured_items ADD COLUMN IF NOT EXISTS animation_config jsonb DEFAULT '{"type": "none", "intensity": "subtle"}'::jsonb;
ALTER TABLE public.featured_items ADD COLUMN IF NOT EXISTS badge_text text;
ALTER TABLE public.featured_items ADD COLUMN IF NOT EXISTS theme_preset text;

-- project_documents: add missing columns
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS tower_id uuid;

-- seller_licenses: add missing columns
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS category_config_id uuid;
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.seller_licenses ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone DEFAULT now();