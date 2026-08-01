-- Add UPI payment fields to seller_profiles
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS accepts_upi BOOLEAN DEFAULT false;
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS upi_id TEXT;