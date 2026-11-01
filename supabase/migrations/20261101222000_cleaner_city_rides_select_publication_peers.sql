-- Guests need sibling rides on the same publication for Drop 1/2/3.
DROP POLICY IF EXISTS rides_select ON public.rides;
CREATE POLICY rides_select ON public.rides
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.is_society_admin(auth.uid(), society_id)
  OR host_user_id = auth.uid()
  OR guest_user_id = auth.uid()
  OR (
    publication_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.rides peer
      WHERE peer.publication_id = rides.publication_id
        AND (
          peer.host_user_id = auth.uid()
          OR peer.guest_user_id = auth.uid()
        )
        AND peer.status IN ('confirmed', 'pickup_pending', 'started', 'requested')
    )
  )
);
