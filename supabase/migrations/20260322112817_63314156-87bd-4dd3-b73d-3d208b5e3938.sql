-- Allow buyers to update (upsert) their own payment proof screenshots
CREATE POLICY "Users can update own payment proofs"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow buyers to delete their own payment proof screenshots
CREATE POLICY "Users can delete own payment proofs"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);