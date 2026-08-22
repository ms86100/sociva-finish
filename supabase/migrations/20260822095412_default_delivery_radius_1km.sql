-- Default service radius is 1 km when the seller has not enabled
-- "sell beyond my community". Sellers who already chose a radius
-- with that switch on are left unchanged.

ALTER TABLE public.seller_profiles
  ALTER COLUMN delivery_radius_km SET DEFAULT 1;

UPDATE public.seller_profiles
SET delivery_radius_km = 1
WHERE COALESCE(sell_beyond_community, false) IS NOT TRUE
  AND delivery_radius_km = 5;
