-- Staging only (wwuanzbusxoyzixuprxs). SSV-017 cutover close:
-- C backfill from profiles.society_id, E membership-only helper.
-- Dual-read (active membership else profiles.society_id) is NOT enabled:
-- pending rows keep profiles.society_id and must not gain hub SELECT.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

INSERT INTO public.society_memberships (
  user_id, society_id, status, invite_verified, requested_at, decided_at
)
SELECT
  p.id,
  p.society_id,
  CASE
    WHEN COALESCE(p.verification_status, '') = 'approved' THEN 'active'
    ELSE 'pending'
  END,
  false,
  now(),
  CASE
    WHEN COALESCE(p.verification_status, '') = 'approved' THEN now()
    ELSE NULL
  END
FROM public.profiles p
WHERE p.society_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.societies s WHERE s.id = p.society_id)
ON CONFLICT (user_id, society_id) DO NOTHING;

-- Cache: active membership wins. Do not copy pending memberships onto profiles.
UPDATE public.profiles p
SET society_id = m.society_id,
    updated_at = now()
FROM public.society_memberships m
WHERE m.user_id = p.id
  AND m.status = 'active'
  AND p.society_id IS DISTINCT FROM m.society_id;

-- Phase E: membership-only. Authenticated JWT still pinned in the public wrapper.
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
