
-- Step 1: Add columns and drop old trigger
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS delivery_handled_by text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_handled_by text;
DROP TRIGGER IF EXISTS trg_validate_fulfillment_mode ON public.seller_profiles;
