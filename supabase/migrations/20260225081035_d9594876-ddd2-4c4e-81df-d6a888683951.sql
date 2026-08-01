ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS show_to_buyers boolean NOT NULL DEFAULT true;