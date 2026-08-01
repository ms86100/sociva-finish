DROP POLICY IF EXISTS "Anyone can view approved sellers" ON public.seller_profiles;
CREATE POLICY "Anyone can view approved sellers" ON public.seller_profiles
  FOR SELECT USING (
    verification_status = 'approved'
    OR user_id = auth.uid()
    OR is_admin(auth.uid())
  );