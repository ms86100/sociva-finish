-- Best-effort rollback for 20261102230000_cleaner_city_phase1_remediation
-- WARNING: Restores weaker privacy policies. Use only if Phase1 must be reverted.
-- Does not restore prior function bodies verbatim (too large). Prefer forward-fix.

DROP FUNCTION IF EXISTS public.cleaner_city_phase1_privacy_selftest();
DROP FUNCTION IF EXISTS public.cleaner_city_leave_circle(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_remove_circle_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_rotate_circle_invite(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_list_circle_members(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_resolve_emergency_notify_user(text);
DROP FUNCTION IF EXISTS public.cleaner_city_release_publication_seat(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_notify_waitlist_for_publication(uuid, boolean);

DROP INDEX IF EXISTS public.uq_commute_publications_host_date_dir_active;

-- Restore pre-Phase1 publication SELECT (society peers could read published rows)
DROP POLICY IF EXISTS commute_publications_select ON public.commute_publications;
CREATE POLICY commute_publications_select ON public.commute_publications
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR host_user_id = auth.uid()
    OR (
      status IN ('published', 'full')
      AND society_id = public.get_user_society_id(auth.uid())
    )
  );

-- Restore pre-Phase1 circle SELECT (society-wide invite leak)
DROP POLICY IF EXISTS commute_circles_read ON public.commute_circles;
CREATE POLICY commute_circles_read ON public.commute_circles
  FOR SELECT TO authenticated
  USING (
    society_id = public.get_user_society_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.commute_circle_members m
      WHERE m.circle_id = id AND m.user_id = auth.uid()
    )
  );

-- Columns invite_expires_at / invite_revoked_at retained (non-destructive).
-- Redeploy prior function definitions from 20261102211000 / 20261102210000 / unit4 if full revert required.
