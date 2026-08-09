-- Fix: payment_gateway_mode toggle fails in admin credentials panel.
--
-- Root cause: upsert_admin_credential routes through vault mirror which may
-- fail silently or face permission issues on the live project. The payment
-- gateway mode is a non-secret config value, not a credential secret, so it
-- should never go through the secret upsert path.
--
-- This migration adds a scoped RPC that only writes payment_gateway_mode and
-- razorpay_route_enabled — no vault, no secret handling.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_payment_gateway_mode(
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('razorpay', 'upi_deep_link') THEN
    RAISE EXCEPTION 'Invalid payment mode. Allowed: razorpay, upi_deep_link';
  END IF;

  INSERT INTO public.admin_settings (key, value, description, is_active)
  VALUES (
    'payment_gateway_mode',
    p_mode,
    'Toggle between UPI Deep Link and Razorpay gateway',
    true
  )
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        is_active  = true,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_gateway_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_gateway_mode(text) TO authenticated, service_role;

-- Also ensure upsert_admin_credential has correct grants in case they drifted.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'upsert_admin_credential'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.signature);
  END LOOP;
END;
$$;

COMMIT;
