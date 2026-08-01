
-- Add DB-driven flags to category_status_flows
ALTER TABLE public.category_status_flows
  ADD COLUMN IF NOT EXISTS is_success boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_otp boolean NOT NULL DEFAULT false;

-- Mark negative terminals
UPDATE public.category_status_flows SET is_success = false WHERE status_key IN ('cancelled', 'no_show');

-- Mark OTP-required steps
UPDATE public.category_status_flows SET requires_otp = true WHERE actor = 'delivery';
