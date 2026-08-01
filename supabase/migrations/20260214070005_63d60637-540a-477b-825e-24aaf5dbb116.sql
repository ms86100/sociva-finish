
-- =============================================
-- HARDENING PHASE: Remaining structural fixes
-- =============================================

-- 1. LAST ADMIN PROTECTION TRIGGER
-- Prevents deactivating the last active society admin unless actor is platform admin
CREATE OR REPLACE FUNCTION public.protect_last_society_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _remaining_count integer;
BEGIN
  -- Only trigger on soft-delete (deactivated_at being set)
  IF OLD.deactivated_at IS NULL AND NEW.deactivated_at IS NOT NULL THEN
    SELECT COUNT(*) INTO _remaining_count
    FROM public.society_admins
    WHERE society_id = OLD.society_id
      AND deactivated_at IS NULL
      AND id != OLD.id;

    IF _remaining_count = 0 THEN
      -- Allow only platform admins to remove the last admin
      IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Cannot remove the last society admin. Appoint a replacement first or contact platform support.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_last_society_admin
BEFORE UPDATE ON public.society_admins
FOR EACH ROW
EXECUTE FUNCTION public.protect_last_society_admin();

-- 2. SOFT DELETE ON builder_members
ALTER TABLE public.builder_members
ADD COLUMN IF NOT EXISTS deactivated_at timestamptz DEFAULT NULL;

-- 3. BUILDER DASHBOARD AGGREGATE FUNCTION
-- Replaces N+1 query pattern with single call
CREATE OR REPLACE FUNCTION public.get_builder_dashboard(_builder_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _builder jsonb;
  _societies jsonb;
BEGIN
  -- Builder info
  SELECT to_jsonb(b.*) INTO _builder
  FROM builders b WHERE b.id = _builder_id;

  IF _builder IS NULL THEN
    RETURN jsonb_build_object('builder', null, 'societies', '[]'::jsonb);
  END IF;

  -- Societies with aggregated counts in one query
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'city', s.city,
      'state', s.state,
      'is_active', s.is_active,
      'is_verified', s.is_verified,
      'is_under_construction', s.is_under_construction,
      'trust_score', s.trust_score,
      'member_count', s.member_count,
      'created_at', s.created_at,
      'pending_users', (
        SELECT COUNT(*) FROM profiles p
        WHERE p.society_id = s.id AND p.verification_status = 'pending'
      ),
      'total_members', (
        SELECT COUNT(*) FROM profiles p
        WHERE p.society_id = s.id AND p.verification_status = 'approved'
      ),
      'pending_sellers', (
        SELECT COUNT(*) FROM seller_profiles sp
        WHERE sp.society_id = s.id AND sp.verification_status = 'pending'
      ),
      'active_sellers', (
        SELECT COUNT(*) FROM seller_profiles sp
        WHERE sp.society_id = s.id AND sp.verification_status = 'approved'
      ),
      'open_disputes', (
        SELECT COUNT(*) FROM dispute_tickets dt
        WHERE dt.society_id = s.id AND dt.status NOT IN ('resolved', 'closed')
      ),
      'open_snags', (
        SELECT COUNT(*) FROM snag_tickets st
        WHERE st.society_id = s.id AND st.status NOT IN ('fixed', 'verified', 'closed')
      )
    ) ORDER BY s.name
  ), '[]'::jsonb) INTO _societies
  FROM societies s
  JOIN builder_societies bs ON bs.society_id = s.id
  WHERE bs.builder_id = _builder_id;

  RETURN jsonb_build_object(
    'builder', _builder,
    'societies', _societies
  );
END;
$$;
