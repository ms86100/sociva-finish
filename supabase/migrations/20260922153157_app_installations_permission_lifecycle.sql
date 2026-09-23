-- Phase 1: app_installations = permission lifecycle / analytics
-- device_tokens remains the push DELIVERY source of truth (unchanged claim_device_token).
-- DO NOT apply to production until Phase 1-3 validated on an isolated environment.

-- ---------------------------------------------------------------------------
-- 1. Installations table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL,
  user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  notification_permission text NOT NULL DEFAULT 'not_requested'
    CHECK (notification_permission IN ('enabled', 'denied', 'not_requested', 'unknown')),
  location_permission text NOT NULL DEFAULT 'not_requested'
    CHECK (location_permission IN ('enabled', 'denied', 'not_requested', 'restricted', 'unknown')),
  -- Optional mirror only - NEVER used for push fan-out (device_tokens is delivery SoT)
  push_token text NULL,
  apns_token text NULL,
  notif_prompt_dismissed_until timestamptz NULL,
  location_prompt_dismissed_until timestamptz NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_installations_installation_id_key UNIQUE (installation_id)
);

CREATE INDEX IF NOT EXISTS idx_app_installations_user_id
  ON public.app_installations (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_installations_notif_perm
  ON public.app_installations (notification_permission);

CREATE INDEX IF NOT EXISTS idx_app_installations_loc_perm
  ON public.app_installations (location_permission);

COMMENT ON TABLE public.app_installations IS
  'Physical install lifecycle + OS permission states. Push delivery remains device_tokens.';

-- ---------------------------------------------------------------------------
-- 2. Link column on device_tokens (analytics only; delivery RPC unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS installation_id text NULL;

CREATE INDEX IF NOT EXISTS idx_device_tokens_installation_id
  ON public.device_tokens (installation_id)
  WHERE installation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS - no direct anon/authenticated writes; guests use SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_installations_select_own ON public.app_installations;
CREATE POLICY app_installations_select_own
  ON public.app_installations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role bypasses RLS for admin analytics / edge functions.

-- ---------------------------------------------------------------------------
-- 4. upsert_app_installation - guest-safe by installation_id; never rotates id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_app_installation(
  p_installation_id text,
  p_platform text,
  p_notification_permission text DEFAULT NULL,
  p_location_permission text DEFAULT NULL,
  p_push_token text DEFAULT NULL,
  p_apns_token text DEFAULT NULL,
  p_claim_user boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_notif text;
  v_loc text;
BEGIN
  IF p_installation_id IS NULL OR length(trim(p_installation_id)) < 8 THEN
    RAISE EXCEPTION 'invalid_installation_id';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'invalid_platform';
  END IF;

  v_notif := COALESCE(
    NULLIF(p_notification_permission, ''),
    'not_requested'
  );
  IF v_notif NOT IN ('enabled', 'denied', 'not_requested', 'unknown') THEN
    RAISE EXCEPTION 'invalid_notification_permission';
  END IF;

  v_loc := COALESCE(
    NULLIF(p_location_permission, ''),
    'not_requested'
  );
  IF v_loc NOT IN ('enabled', 'denied', 'not_requested', 'restricted', 'unknown') THEN
    RAISE EXCEPTION 'invalid_location_permission';
  END IF;

  INSERT INTO public.app_installations AS ai (
    installation_id,
    platform,
    notification_permission,
    location_permission,
    push_token,
    apns_token,
    user_id,
    last_seen_at,
    updated_at
  )
  VALUES (
    trim(p_installation_id),
    p_platform,
    v_notif,
    v_loc,
    NULLIF(p_push_token, ''),
    NULLIF(p_apns_token, ''),
    CASE WHEN p_claim_user AND v_uid IS NOT NULL THEN v_uid ELSE NULL END,
    now(),
    now()
  )
  ON CONFLICT (installation_id) DO UPDATE SET
    platform = EXCLUDED.platform,
    -- Only overwrite permission enums when caller supplies a non-null value
    -- (pass NULL from client to mean "leave unchanged" - use sentinel via COALESCE above
    -- only on INSERT; on UPDATE use distinct args)
    notification_permission = CASE
      WHEN p_notification_permission IS NULL THEN ai.notification_permission
      ELSE v_notif
    END,
    location_permission = CASE
      WHEN p_location_permission IS NULL THEN ai.location_permission
      ELSE v_loc
    END,
    push_token = COALESCE(NULLIF(p_push_token, ''), ai.push_token),
    apns_token = COALESCE(NULLIF(p_apns_token, ''), ai.apns_token),
    -- Claim when requested + authenticated; never clear user_id here (use release RPC)
    user_id = CASE
      WHEN p_claim_user AND v_uid IS NOT NULL THEN v_uid
      ELSE ai.user_id
    END,
    last_seen_at = now(),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_app_installation(text, text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_app_installation(text, text, text, text, text, text, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. claim_app_installation - login: associate install with current user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_app_installation(p_installation_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_installation_id IS NULL OR length(trim(p_installation_id)) < 8 THEN
    RAISE EXCEPTION 'invalid_installation_id';
  END IF;

  UPDATE public.app_installations
  SET
    user_id = v_uid,
    last_seen_at = now(),
    updated_at = now()
  WHERE installation_id = trim(p_installation_id);

  IF NOT FOUND THEN
    -- Ensure row exists (race: sync not yet written)
    INSERT INTO public.app_installations (installation_id, platform, user_id)
    VALUES (trim(p_installation_id), 'web', v_uid)
    ON CONFLICT (installation_id) DO UPDATE SET
      user_id = v_uid,
      last_seen_at = now(),
      updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_app_installation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_app_installation(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. release_app_installation_user - logout: clear user_id only; keep install
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_app_installation_user(p_installation_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_installation_id IS NULL OR length(trim(p_installation_id)) < 8 THEN
    RAISE EXCEPTION 'invalid_installation_id';
  END IF;

  -- Clear association for this physical install. Do NOT delete the row.
  -- Do NOT rotate installation_id. Permissions + mirrored tokens remain.
  UPDATE public.app_installations
  SET
    user_id = NULL,
    updated_at = now(),
    last_seen_at = now()
  WHERE installation_id = trim(p_installation_id)
    AND (auth.uid() IS NULL OR user_id = auth.uid() OR user_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.release_app_installation_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_app_installation_user(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. stamp_device_token_installation - after claim_device_token (delivery intact)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_device_token_installation(
  p_token text,
  p_installation_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF p_token IS NULL OR p_installation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.device_tokens
  SET installation_id = trim(p_installation_id),
      updated_at = now()
  WHERE user_id = v_uid
    AND token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_device_token_installation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_device_token_installation(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin aggregate (service role / authenticated admin via existing is_admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_permission_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'total_installations', (SELECT count(*) FROM public.app_installations),
    'notification', (
      SELECT jsonb_object_agg(notification_permission, cnt)
      FROM (
        SELECT notification_permission, count(*)::int AS cnt
        FROM public.app_installations
        GROUP BY notification_permission
      ) s
    ),
    'location', (
      SELECT jsonb_object_agg(location_permission, cnt)
      FROM (
        SELECT location_permission, count(*)::int AS cnt
        FROM public.app_installations
        GROUP BY location_permission
      ) s
    ),
    'claimed_users_notif_off', (
      SELECT count(DISTINCT user_id) FROM public.app_installations
      WHERE user_id IS NOT NULL
        AND notification_permission IS DISTINCT FROM 'enabled'
    ),
    'claimed_users_location_off', (
      SELECT count(DISTINCT user_id) FROM public.app_installations
      WHERE user_id IS NOT NULL
        AND location_permission IS DISTINCT FROM 'enabled'
    ),
    'claimed_users_both_off', (
      SELECT count(DISTINCT user_id) FROM public.app_installations
      WHERE user_id IS NOT NULL
        AND notification_permission IS DISTINCT FROM 'enabled'
        AND location_permission IS DISTINCT FROM 'enabled'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_permission_health_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_permission_health_summary() TO authenticated;
