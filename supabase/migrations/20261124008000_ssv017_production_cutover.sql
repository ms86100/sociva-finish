-- Live production kkzkuyhgdvyecmxtmkpy only.
-- Authorized SSV-017 cutover: create society_memberships, backfill, JWT-pin helper.
-- Backfill every profile with a valid society_id as active so current access stays
-- (production today treats profiles.society_id as the society, including pending verification).
-- Do not copy staging CAF (SSV-015/016) or visitor RPCs here.

CREATE TABLE IF NOT EXISTS public.society_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'suspended'::text, 'removed'::text])),
  invite_verified boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, society_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS society_memberships_one_active_user
  ON public.society_memberships (user_id)
  WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS society_memberships_society_status_idx
  ON public.society_memberships (society_id, status);

ALTER TABLE public.society_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS society_memberships_select_own ON public.society_memberships;
CREATE POLICY society_memberships_select_own
ON public.society_memberships
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
);

REVOKE INSERT, UPDATE, DELETE ON public.society_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.society_memberships TO authenticated;

INSERT INTO public.society_memberships (
  user_id, society_id, status, invite_verified, requested_at, decided_at
)
SELECT
  p.id,
  p.society_id,
  'active',
  false,
  now(),
  now()
FROM public.profiles p
WHERE p.society_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.societies s WHERE s.id = p.society_id)
ON CONFLICT (user_id, society_id) DO NOTHING;

DO $$
DECLARE
  v_expected int;
  v_got int;
BEGIN
  SELECT count(*) INTO v_expected
  FROM public.profiles p
  WHERE p.society_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.societies s WHERE s.id = p.society_id);

  SELECT count(*) INTO v_got
  FROM public.society_memberships
  WHERE status = 'active';

  IF v_got < v_expected THEN
    RAISE EXCEPTION 'SSV-017 backfill short: active=% expected=%', v_got, v_expected;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS sociva_private;
REVOKE ALL ON SCHEMA sociva_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sociva_private TO postgres, service_role;

CREATE OR REPLACE FUNCTION sociva_private.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.society_id
  FROM public.society_memberships m
  WHERE m.user_id = _user_id
    AND m.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN NULL;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.get_user_society_id(auth.uid());
  END IF;
  RETURN sociva_private.get_user_society_id(_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_society_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO anon, authenticated, service_role;
