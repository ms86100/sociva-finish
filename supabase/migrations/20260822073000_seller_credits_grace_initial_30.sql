-- Initial Admin configuration only. The resolver reads this row; application
-- code must not hardcode 30 minutes.
UPDATE public.seller_credit_settings
SET value = '30'
WHERE key = 'booking_resolution_grace_minutes'
  AND (value IS NULL OR btrim(value) = '');
