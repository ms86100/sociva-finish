DROP POLICY IF EXISTS "Users can update their own tokens" ON public.device_tokens;
CREATE POLICY "Users can update their own tokens"
  ON public.device_tokens
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);