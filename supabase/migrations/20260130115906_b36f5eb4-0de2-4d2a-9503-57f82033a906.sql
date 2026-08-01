-- Add Razorpay linked account fields to seller_profiles
ALTER TABLE public.seller_profiles
ADD COLUMN IF NOT EXISTS razorpay_account_id text,
ADD COLUMN IF NOT EXISTS bank_account_number text,
ADD COLUMN IF NOT EXISTS bank_ifsc_code text,
ADD COLUMN IF NOT EXISTS bank_account_holder text,
ADD COLUMN IF NOT EXISTS razorpay_onboarding_status text DEFAULT 'pending';

-- Add Razorpay order tracking fields to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS razorpay_order_id text,
ADD COLUMN IF NOT EXISTS razorpay_payment_id text;