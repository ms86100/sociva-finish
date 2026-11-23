-- Society hub hardening (staging-first): feature gates on ops tables,
-- bulletin vote/RSVP society scope, admin package assign DEFINER RPC.
-- Architecture: VOLATILE when rate-limited; no RLS weakening; society-scoped keys.

-- ---------------------------------------------------------------------------
-- 1) Bulletin votes / RSVPs: stop world-readable SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view vote counts" ON public.bulletin_votes;
DROP POLICY IF EXISTS "Society members can view votes" ON public.bulletin_votes;

CREATE POLICY "Society members can view votes"
ON public.bulletin_votes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bulletin_posts bp
    WHERE bp.id = bulletin_votes.post_id
      AND (
        bp.society_id = public.get_user_society_id((SELECT auth.uid()))
        OR public.is_admin((SELECT auth.uid()))
      )
      AND (
        public.is_admin((SELECT auth.uid()))
        OR public.can_access_feature(bp.society_id, 'bulletin')
      )
  )
);

DROP POLICY IF EXISTS "Society members can view RSVPs" ON public.bulletin_rsvps;

CREATE POLICY "Society members can view RSVPs"
ON public.bulletin_rsvps
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bulletin_posts bp
    WHERE bp.id = bulletin_rsvps.post_id
      AND (
        bp.society_id = public.get_user_society_id((SELECT auth.uid()))
        OR public.is_admin((SELECT auth.uid()))
      )
      AND (
        public.is_admin((SELECT auth.uid()))
        OR public.can_access_feature(bp.society_id, 'bulletin')
      )
  )
);

-- ---------------------------------------------------------------------------
-- 2) Server-side feature gates: notices / parcels / disputes / visitors
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Society members can view notices" ON public.society_notices;
CREATE POLICY "Society members can view notices"
ON public.society_notices
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'society_notices')
  )
);

DROP POLICY IF EXISTS "Admins can create notices" ON public.society_notices;
CREATE POLICY "Admins can create notices"
ON public.society_notices
FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.is_admin((SELECT auth.uid()))
    OR public.is_society_admin((SELECT auth.uid()), society_id)
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'society_notices')
  )
);

DROP POLICY IF EXISTS "soc_read_parcels" ON public.parcel_entries;
CREATE POLICY "soc_read_parcels"
ON public.parcel_entries
FOR SELECT
TO authenticated
USING (
  (
    resident_id = (SELECT auth.uid())
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'parcel_management')
  )
);

DROP POLICY IF EXISTS "soc_insert_parcels" ON public.parcel_entries;
CREATE POLICY "soc_insert_parcels"
ON public.parcel_entries
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'parcel_management')
  )
);

DROP POLICY IF EXISTS "soc_update_parcels" ON public.parcel_entries;
CREATE POLICY "soc_update_parcels"
ON public.parcel_entries
FOR UPDATE
TO authenticated
USING (
  (
    resident_id = (SELECT auth.uid())
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'parcel_management')
  )
)
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  OR public.is_admin((SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Users can view own disputes" ON public.dispute_tickets;
CREATE POLICY "Users can view own disputes"
ON public.dispute_tickets
FOR SELECT
TO authenticated
USING (
  (
    raised_by = (SELECT auth.uid())
    OR submitted_by = (SELECT auth.uid())
    OR against_user = (SELECT auth.uid())
    OR public.is_admin((SELECT auth.uid()))
    OR (
      society_id IS NOT NULL
      AND society_id = public.get_user_society_id((SELECT auth.uid()))
    )
  )
  AND (
    society_id IS NULL
    OR public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'disputes')
  )
);

DROP POLICY IF EXISTS "Users can create disputes" ON public.dispute_tickets;
CREATE POLICY "Users can create disputes"
ON public.dispute_tickets
FOR INSERT
TO authenticated
WITH CHECK (
  raised_by = (SELECT auth.uid())
  AND (
    society_id IS NULL
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
  )
  AND (
    society_id IS NULL
    OR public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'disputes')
  )
);

-- Visitor SELECT: keep society/staff scope + require visitor/gate feature
DROP POLICY IF EXISTS visitor_entries_select_society ON public.visitor_entries;
CREATE POLICY visitor_entries_select_society
ON public.visitor_entries
FOR SELECT
TO authenticated
USING (
  (
    public.is_admin((SELECT auth.uid()))
    OR public.is_society_admin((SELECT auth.uid()), society_id)
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.security_staff ss
      WHERE ss.user_id = (SELECT auth.uid())
        AND ss.society_id = visitor_entries.society_id
        AND ss.is_active = true
    )
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'visitor_management')
    OR public.can_access_feature(society_id, 'gate_entry')
  )
);

-- ---------------------------------------------------------------------------
-- 3) Admin package assign + builder link (DEFINER, rate-limited, audited)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.society_onboard_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  society_id uuid,
  actor_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.society_onboard_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read onboard audit" ON public.society_onboard_audit;
CREATE POLICY "Admins read onboard audit"
ON public.society_onboard_audit
FOR SELECT
TO authenticated
USING (public.is_admin((SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.admin_assign_society_package(
  _society_id uuid,
  _package_id uuid,
  _builder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_builder uuid;
  v_link_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _society_id IS NULL OR _package_id IS NULL THEN
    RAISE EXCEPTION 'society and package are required';
  END IF;

  PERFORM public.sociva_assert_rate_limit(
    'admin_assign_pkg:' || v_uid::text,
    30,
    60
  );

  IF NOT EXISTS (SELECT 1 FROM public.societies WHERE id = _society_id) THEN
    RAISE EXCEPTION 'society not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_packages WHERE id = _package_id) THEN
    RAISE EXCEPTION 'package not found';
  END IF;

  v_builder := _builder_id;

  IF v_builder IS NULL THEN
    SELECT bs.builder_id INTO v_builder
    FROM public.builder_societies bs
    WHERE bs.society_id = _society_id
    LIMIT 1;
  END IF;

  IF v_builder IS NULL THEN
    SELECT b.id INTO v_builder
    FROM public.builders b
    WHERE b.is_active IS TRUE
    ORDER BY b.created_at ASC
    LIMIT 1;
  END IF;

  IF v_builder IS NULL THEN
    RAISE EXCEPTION 'Create or select a builder first';
  END IF;

  SELECT bs.id INTO v_link_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  IF v_link_id IS NULL THEN
    INSERT INTO public.builder_societies (builder_id, society_id)
    VALUES (v_builder, _society_id);
  ELSIF _builder_id IS NOT NULL THEN
    UPDATE public.builder_societies
    SET builder_id = _builder_id
    WHERE id = v_link_id;
    v_builder := _builder_id;
  ELSE
    SELECT bs.builder_id INTO v_builder
    FROM public.builder_societies bs
    WHERE bs.id = v_link_id;
  END IF;

  INSERT INTO public.builder_feature_packages (builder_id, package_id, assigned_by)
  VALUES (v_builder, _package_id, v_uid)
  ON CONFLICT (builder_id, package_id) DO NOTHING;

  UPDATE public.societies
  SET builder_id = v_builder
  WHERE id = _society_id;

  INSERT INTO public.society_onboard_audit (action, society_id, actor_id, payload)
  VALUES (
    'assign_package',
    _society_id,
    v_uid,
    jsonb_build_object(
      'package_id', _package_id,
      'builder_id', v_builder
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'builder_id', v_builder,
    'society_id', _society_id,
    'package_id', _package_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_society_package(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_society_package(uuid, uuid, uuid) TO authenticated, service_role;
