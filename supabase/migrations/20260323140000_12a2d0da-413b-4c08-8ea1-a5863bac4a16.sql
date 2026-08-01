
-- Step 1A: Add transaction_type column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS transaction_type text;

-- Step 1B: Add is_transit flag to category_status_flows
ALTER TABLE public.category_status_flows ADD COLUMN IF NOT EXISTS is_transit boolean NOT NULL DEFAULT false;
