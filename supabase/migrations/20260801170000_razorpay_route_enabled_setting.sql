-- Razorpay Route transfers are NOT wired. Keep flag false until linked accounts exist.
-- process-settlements only marks settlements "eligible" when this is false — never "settled".

INSERT INTO public.admin_settings (key, value, is_active, description)
VALUES (
  'razorpay_route_enabled',
  'false',
  false,
  'When true, process-settlements may attempt Razorpay Route transfers. Default false: mark eligible only — no fake settled/paid-out status without a real transfer.'
)
ON CONFLICT (key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();
-- Do not overwrite an intentional true if an admin already flipped it; only seed when missing was handled by INSERT.
-- If row existed with null/empty value, normalize to false:
UPDATE public.admin_settings
SET value = 'false', is_active = false, updated_at = now()
WHERE key = 'razorpay_route_enabled'
  AND (value IS NULL OR btrim(value) = '');
