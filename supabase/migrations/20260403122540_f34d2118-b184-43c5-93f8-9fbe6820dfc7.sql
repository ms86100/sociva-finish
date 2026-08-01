
-- Add per-fulfillment payment configuration columns
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS pickup_payment_config jsonb NOT NULL DEFAULT '{"accepts_cod":true,"accepts_online":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_payment_config jsonb NOT NULL DEFAULT '{"accepts_cod":true,"accepts_online":true}'::jsonb;

-- Backfill from existing accepts_cod / accepts_upi for all sellers
UPDATE public.seller_profiles
SET
  pickup_payment_config = jsonb_build_object(
    'accepts_cod', COALESCE(accepts_cod, true),
    'accepts_online', COALESCE(accepts_upi, false)
  ),
  delivery_payment_config = jsonb_build_object(
    'accepts_cod', COALESCE(accepts_cod, true),
    'accepts_online', COALESCE(accepts_upi, false)
  );

-- Add CHECK constraint: at least one payment method must be enabled per config
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_pickup_payment_config
    CHECK (
      (pickup_payment_config->>'accepts_cod')::boolean IS TRUE
      OR (pickup_payment_config->>'accepts_online')::boolean IS TRUE
    ),
  ADD CONSTRAINT chk_delivery_payment_config
    CHECK (
      (delivery_payment_config->>'accepts_cod')::boolean IS TRUE
      OR (delivery_payment_config->>'accepts_online')::boolean IS TRUE
    );
