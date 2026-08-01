
-- Add food license columns to seller_profiles
ALTER TABLE public.seller_profiles 
  ADD COLUMN food_license_url text,
  ADD COLUMN food_license_status text DEFAULT 'none' CHECK (food_license_status IN ('none', 'pending', 'approved', 'rejected')),
  ADD COLUMN food_license_submitted_at timestamptz,
  ADD COLUMN food_license_reviewed_at timestamptz;

-- Insert admin setting for food license toggle (default OFF)
INSERT INTO public.admin_settings (key, value, description, is_active)
VALUES ('require_food_license', 'false', 'When enabled, food category sellers must upload a valid food license document', true)
ON CONFLICT (key) DO NOTHING;
