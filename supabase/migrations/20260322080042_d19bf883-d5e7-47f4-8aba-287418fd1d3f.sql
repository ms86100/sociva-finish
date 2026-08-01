CREATE POLICY "Authenticated users can read non-secret settings"
ON public.admin_settings
FOR SELECT
TO authenticated
USING (
  key IN ('payment_gateway_mode')
);