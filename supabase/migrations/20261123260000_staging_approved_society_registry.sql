-- STAGING ONLY (wwuanzbusxoyzixuprxs). Do not apply to production (kkzkuyhgdvyecmxtmkpy).
-- Residents may join admin-approved societies only. Maps never creates a society.
-- Hub writes stay inside get_user_society_id. Marketplace cross-society stays sell_beyond_community.

-- 1) Stop any authenticated user from inserting a society row.
DROP POLICY IF EXISTS "Users can request societies" ON public.societies;

DROP POLICY IF EXISTS "Anyone can view active societies" ON public.societies;
DROP POLICY IF EXISTS "approved_societies_are_listed" ON public.societies;
CREATE POLICY "approved_societies_are_listed"
  ON public.societies
  FOR SELECT
  TO anon, authenticated
  USING (
    (is_verified IS TRUE AND is_active IS TRUE)
    OR public.is_admin((SELECT auth.uid()))
  );

-- 2) Resident "add this society" queue. Admin still creates via the wizard.
CREATE TABLE IF NOT EXISTS public.society_registry_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  city text,
  state text,
  pincode text,
  landmark text,
  contact text,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_registry_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_society_registry_requests_status
  ON public.society_registry_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_society_registry_requests_user
  ON public.society_registry_requests (user_id, created_at DESC);

ALTER TABLE public.society_registry_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own registry requests insert" ON public.society_registry_requests;
CREATE POLICY "own registry requests insert"
  ON public.society_registry_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "own registry requests select" ON public.society_registry_requests;
CREATE POLICY "own registry requests select"
  ON public.society_registry_requests
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "admin registry requests update" ON public.society_registry_requests;
CREATE POLICY "admin registry requests update"
  ON public.society_registry_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.submit_society_registry_request(
  _name text,
  _address text DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _pincode text DEFAULT NULL,
  _landmark text DEFAULT NULL,
  _contact text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.society_registry_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_name, ''))) < 3 THEN
    RAISE EXCEPTION 'Society name is required';
  END IF;

  PERFORM public.sociva_assert_rate_limit('society_registry:' || v_uid::text, 5, 3600);

  INSERT INTO public.society_registry_requests (
    user_id, name, address, city, state, pincode, landmark, contact
  ) VALUES (
    v_uid,
    left(btrim(_name), 200),
    NULLIF(left(btrim(COALESCE(_address, '')), 300), ''),
    NULLIF(left(btrim(COALESCE(_city, '')), 80), ''),
    NULLIF(left(btrim(COALESCE(_state, '')), 80), ''),
    NULLIF(left(btrim(COALESCE(_pincode, '')), 12), ''),
    NULLIF(left(btrim(COALESCE(_landmark, '')), 120), ''),
    NULLIF(left(btrim(COALESCE(_contact, '')), 20), '')
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_society_registry_request(text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_society_registry_request(text, text, text, text, text, text, text) TO authenticated;

-- 3) Membership join remains DEFINER + approved-only, now rate-limited.
CREATE OR REPLACE FUNCTION public.request_society_membership(
  _society_id uuid,
  _invite_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_soc public.societies%ROWTYPE;
  v_existing public.society_memberships%ROWTYPE;
  v_status text;
  v_invite_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _society_id IS NULL THEN
    RAISE EXCEPTION 'society_id required';
  END IF;

  PERFORM public.sociva_assert_rate_limit('membership_request:' || v_uid::text, 8, 3600);

  SELECT * INTO v_soc FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Society not found';
  END IF;
  IF COALESCE(v_soc.is_active, false) IS NOT TRUE
     OR COALESCE(v_soc.is_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only approved societies can be joined';
  END IF;

  IF NULLIF(btrim(COALESCE(v_soc.invite_code, '')), '') IS NOT NULL THEN
    IF lower(btrim(COALESCE(_invite_code, ''))) IS DISTINCT FROM lower(btrim(v_soc.invite_code)) THEN
      RAISE EXCEPTION 'invite_required' USING ERRCODE = '42501';
    END IF;
    v_invite_ok := true;
  ELSE
    v_invite_ok := true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.society_memberships
    WHERE user_id = v_uid
      AND status = 'active'
      AND society_id IS DISTINCT FROM _society_id
  ) THEN
    RAISE EXCEPTION 'Already an active member of another society';
  END IF;

  SELECT * INTO v_existing
  FROM public.society_memberships
  WHERE user_id = v_uid AND society_id = _society_id;

  IF v_existing.status IN ('suspended', 'removed') THEN
    RAISE EXCEPTION 'Membership is not eligible to rejoin';
  END IF;

  v_status := CASE
    WHEN COALESCE(v_soc.auto_approve_residents, false) THEN 'active'
    ELSE 'pending'
  END;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'active' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'active',
        'society_id', _society_id,
        'membership_id', v_existing.id
      );
    END IF;
    UPDATE public.society_memberships
    SET status = v_status,
        invite_verified = v_invite_ok,
        requested_at = now(),
        updated_at = now(),
        decided_at = CASE WHEN v_status = 'active' THEN now() ELSE NULL END
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  ELSE
    INSERT INTO public.society_memberships (
      user_id, society_id, status, invite_verified, decided_at
    )
    VALUES (
      v_uid, _society_id, v_status, v_invite_ok,
      CASE WHEN v_status = 'active' THEN now() ELSE NULL END
    )
    RETURNING * INTO v_existing;
  END IF;

  PERFORM set_config('app.allow_society_change', 'true', true);
  IF v_status = 'active' THEN
    PERFORM set_config('app.allow_verification_change', 'true', true);
    UPDATE public.profiles
    SET society_id = _society_id,
        verification_status = 'approved'
    WHERE id = v_uid;
  ELSE
    UPDATE public.profiles
    SET society_id = _society_id
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_existing.status,
    'society_id', _society_id,
    'membership_id', v_existing.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_society_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_society_membership(uuid, text) TO authenticated;

-- 4) Snags stay inside the resident's society. Members can see society tickets.
DROP POLICY IF EXISTS "Users can create snags" ON public.snag_tickets;
CREATE POLICY "Users can create snags"
  ON public.snag_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reported_by = (SELECT auth.uid())
    AND (
      society_id = public.get_user_society_id((SELECT auth.uid()))
      OR public.is_admin((SELECT auth.uid()))
      OR public.is_society_admin((SELECT auth.uid()), society_id)
    )
  );

DROP POLICY IF EXISTS "Users can view own snags" ON public.snag_tickets;
DROP POLICY IF EXISTS "Users can view society snags" ON public.snag_tickets;
CREATE POLICY "Users can view society snags"
  ON public.snag_tickets
  FOR SELECT
  TO authenticated
  USING (
    reported_by = (SELECT auth.uid())
    OR public.is_admin((SELECT auth.uid()))
    OR public.is_society_admin((SELECT auth.uid()), society_id)
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
  );

-- 5) Staging cleanup: street-address rows are not societies.
UPDATE public.societies
SET is_verified = false,
    is_active = false
WHERE id = '9e4309ea-cf86-4fc4-9391-a33f37343ddc'
  AND name ILIKE '%Shriram Greenfield Phase 1 Rd%';

-- 6) Seed one Greenfield snag so the hub module is not empty.
INSERT INTO public.snag_tickets (
  society_id, reported_by, category, title, description, status, priority, unit_number
)
SELECT
  '327fb699-542e-4ab6-b0b1-97022604bb88',
  'ee4a9985-ddad-432b-8d92-7bfe9e384c51',
  'plumbing',
  'Kitchen mixer drip in H-1204',
  'Slow drip from the mixer after handover. Logged so RWA can track the snag.',
  'reported',
  'medium',
  'H-1204'
WHERE NOT EXISTS (
  SELECT 1 FROM public.snag_tickets
  WHERE society_id = '327fb699-542e-4ab6-b0b1-97022604bb88'
);

INSERT INTO public.society_notices (
  society_id, posted_by, title, body, category, is_pinned
)
SELECT
  '327fb699-542e-4ab6-b0b1-97022604bb88',
  'ee4a9985-ddad-432b-8d92-7bfe9e384c51',
  'Gate OTP is now live',
  'Add visitors from the Visitors tile. Guards verify the OTP at the kiosk. This notice is only visible inside Tower H.',
  'safety',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.society_notices
  WHERE society_id = '327fb699-542e-4ab6-b0b1-97022604bb88'
    AND title = 'Gate OTP is now live'
);
