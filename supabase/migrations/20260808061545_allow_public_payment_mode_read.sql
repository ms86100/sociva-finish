-- Backward compatibility for deployed clients that still read this one public
-- toggle directly. RLS continues to hide every credential/secret row.
DROP POLICY IF EXISTS "Public can read payment gateway mode"
  ON public.admin_settings;

CREATE POLICY "Public can read payment gateway mode"
  ON public.admin_settings
  FOR SELECT
  TO anon, authenticated
  USING (key = 'payment_gateway_mode');

COMMENT ON POLICY "Public can read payment gateway mode"
  ON public.admin_settings IS
  'Exposes only the non-secret checkout mode; all credential rows remain hidden.';
