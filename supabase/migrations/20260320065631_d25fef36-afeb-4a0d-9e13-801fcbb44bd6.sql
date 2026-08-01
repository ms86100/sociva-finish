
-- Create storage buckets for category and subcategory images
INSERT INTO storage.buckets (id, name, public) VALUES ('category-images', 'category-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('subcategory-images', 'subcategory-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Category images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id IN ('category-images', 'subcategory-images'));

-- Authenticated users can upload/update
CREATE POLICY "Authenticated users can upload category images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id IN ('category-images', 'subcategory-images'));

CREATE POLICY "Authenticated users can update category images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id IN ('category-images', 'subcategory-images'));

CREATE POLICY "Authenticated users can delete category images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id IN ('category-images', 'subcategory-images'));
