-- Staging only (wwuanzbusxoyzixuprxs). SSV-018:
-- Replace builder_societies SELECT USING (true) with membership / builder /
-- society-admin / platform-admin. Writes stay admin-only.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

DROP POLICY IF EXISTS "Anyone can view builder-society links" ON public.builder_societies;
DROP POLICY IF EXISTS "Builder societies visible to builder members" ON public.builder_societies;
DROP POLICY IF EXISTS builder_societies_select_scoped ON public.builder_societies;

CREATE POLICY builder_societies_select_scoped
ON public.builder_societies
FOR SELECT
TO authenticated
USING (
  public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), builder_societies.society_id)
  OR public.has_active_society_membership((SELECT auth.uid()), builder_societies.society_id)
  OR EXISTS (
    SELECT 1
    FROM public.builder_members bm
    WHERE bm.builder_id = builder_societies.builder_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

REVOKE ALL ON TABLE public.builder_societies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.builder_societies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.builder_societies TO service_role;
