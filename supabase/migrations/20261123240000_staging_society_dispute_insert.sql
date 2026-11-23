-- Staging only: society-ops concerns may exist without an order.
-- Production is frozen; do not apply this to kkzkuyhgdvyecmxtmkpy until copy-forward.

ALTER TABLE public.dispute_tickets
  ALTER COLUMN order_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can create disputes" ON public.dispute_tickets;
CREATE POLICY "Users can create disputes"
ON public.dispute_tickets
FOR INSERT
TO authenticated
WITH CHECK (
  raised_by = (SELECT auth.uid())
  AND (
    society_id IS NULL
    OR society_id = public.get_user_society_id(auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can view own disputes" ON public.dispute_tickets;
CREATE POLICY "Users can view own disputes"
ON public.dispute_tickets
FOR SELECT
TO authenticated
USING (
  raised_by = (SELECT auth.uid())
  OR submitted_by = (SELECT auth.uid())
  OR against_user = (SELECT auth.uid())
  OR public.is_admin((SELECT auth.uid()))
  OR (
    society_id IS NOT NULL
    AND society_id = public.get_user_society_id(auth.uid())
  )
);

ALTER TABLE public.dispute_tickets
  DROP CONSTRAINT IF EXISTS dispute_tickets_raised_by_fkey;
ALTER TABLE public.dispute_tickets
  ADD CONSTRAINT dispute_tickets_raised_by_fkey
  FOREIGN KEY (raised_by) REFERENCES public.profiles(id);

ALTER TABLE public.dispute_tickets
  DROP CONSTRAINT IF EXISTS dispute_tickets_submitted_by_fkey;
ALTER TABLE public.dispute_tickets
  ADD CONSTRAINT dispute_tickets_submitted_by_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.profiles(id);

ALTER TABLE public.dispute_tickets
  DROP CONSTRAINT IF EXISTS dispute_tickets_against_user_fkey;
ALTER TABLE public.dispute_tickets
  ADD CONSTRAINT dispute_tickets_against_user_fkey
  FOREIGN KEY (against_user) REFERENCES public.profiles(id);
