-- Sellers own stores via seller_profiles; seller_id is store id, not auth.uid().
-- Previous policy used seller_id = auth.uid() which hid all contact leads for real sellers.

DROP POLICY IF EXISTS "Users can view own interactions" ON public.seller_contact_interactions;
CREATE POLICY "Users can view own interactions"
  ON public.seller_contact_interactions
  FOR SELECT
  USING (
    buyer_id = auth.uid()
    OR seller_id IN (
      SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Sellers can update own interactions" ON public.seller_contact_interactions;
CREATE POLICY "Sellers can update own interactions"
  ON public.seller_contact_interactions
  FOR UPDATE
  USING (
    seller_id IN (
      SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    seller_id IN (
      SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );
