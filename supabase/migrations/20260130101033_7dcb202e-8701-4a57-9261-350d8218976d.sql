-- Create storage bucket for app images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-images', 
  'app-images', 
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

-- Storage policies for app-images bucket

-- Anyone can view images (public bucket)
CREATE POLICY "Public read access for app images"
ON storage.objects FOR SELECT
USING (bucket_id = 'app-images');

-- Authenticated users can upload their own images
CREATE POLICY "Authenticated users can upload images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'app-images' 
  AND auth.role() = 'authenticated'
);

-- Users can update their own uploaded images
CREATE POLICY "Users can update their own images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'app-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own uploaded images
CREATE POLICY "Users can delete their own images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'app-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Add is_urgent column to products table for urgent order notification toggle
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.products.is_urgent IS 'If true, orders for this product require immediate seller response with countdown timer';

-- Add rejection_reason column to orders table
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN public.orders.rejection_reason IS 'Reason provided by seller when rejecting an order';

-- Add auto_cancel_at column to track when order should auto-cancel
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS auto_cancel_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.auto_cancel_at IS 'Timestamp when order will be auto-cancelled if not acted upon';