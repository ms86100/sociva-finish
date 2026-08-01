
-- Add rich configuration columns to subcategories table
ALTER TABLE public.subcategories
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS color text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS name_placeholder text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description_placeholder text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_label text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_label text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_veg_toggle boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_duration_field boolean DEFAULT NULL;

-- Create storage bucket for subcategory images
INSERT INTO storage.buckets (id, name, public)
VALUES ('subcategory-images', 'subcategory-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for subcategory images
CREATE POLICY "Anyone can view subcategory images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'subcategory-images');

CREATE POLICY "Authenticated users can upload subcategory images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'subcategory-images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update subcategory images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'subcategory-images' AND auth.role() = 'authenticated');
