-- ------------------------------------------------------------
ALTER TABLE public.checkout_groups
  ADD COLUMN IF NOT EXISTS amount_refunded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gateway_captured_amount numeric;

COMMENT ON COLUMN public.checkout_groups.amount_refunded IS
  'Sum of completed gateway refunds against the shared Razorpay capture.';
COMMENT ON COLUMN public.checkout_groups.gateway_captured_amount IS
  'Residual INR captured via Razorpay for this group (sum of child total_amount at pay).';

