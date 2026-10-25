-- Authenticated buyers/sellers can upload to app-images when they have a real session.
-- auth.uid() is more reliable than auth.role() in Storage RLS.
DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
CREATE POLICY "Authenticated users can upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'app-images'
  AND auth.uid() IS NOT NULL
);
