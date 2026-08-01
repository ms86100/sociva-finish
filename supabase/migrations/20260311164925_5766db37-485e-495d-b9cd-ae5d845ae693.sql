-- Add UPI deep link payment columns to orders table
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS upi_transaction_ref text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by_seller boolean DEFAULT null,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;