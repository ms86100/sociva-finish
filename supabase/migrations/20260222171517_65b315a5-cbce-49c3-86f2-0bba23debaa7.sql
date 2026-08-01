-- G5 Fix: Allow admins and society admins to insert parcels for other residents
DROP POLICY IF EXISTS "Members can log parcels" ON public.parcel_entries;

CREATE POLICY "Members can log parcels"
ON public.parcel_entries
FOR INSERT
WITH CHECK (
  (resident_id = auth.uid() AND can_write_to_society(auth.uid(), society_id))
  OR is_society_admin(auth.uid(), society_id)
  OR is_admin(auth.uid())
);