-- Public clients need one non-secret payment-mode value. Direct SELECT on
-- admin_settings is intentionally blocked to protect credentials.
CREATE OR REPLACE FUNCTION public.get_public_payment_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN s.is_active = true AND s.value = 'razorpay' THEN 'razorpay'
    ELSE 'upi_deep_link'
  END
  FROM (SELECT 1) AS seed
  LEFT JOIN public.admin_settings s
    ON s.key = 'payment_gateway_mode'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_payment_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_payment_mode()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_payment_mode() IS
  'Returns only the active public checkout mode; never exposes credential values.';
