-- A Cleaner City Unit 2: commute profile upsert, work-email OTP RPCs, domain admin,
-- verification gate helper. Email delivery is via edge function (Resend credential).

CREATE OR REPLACE FUNCTION public.cleaner_city_is_personal_or_disposable_domain(p_domain text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(p_domain) = ANY (ARRAY[
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com','hotmail.com',
    'live.com','icloud.com','me.com','proton.me','protonmail.com','aol.com','mail.com',
    'yandex.com','zoho.com','gmx.com','rediffmail.com','inbox.com','mailinator.com',
    'guerrillamail.com','tempmail.com','10minutemail.com','yopmail.com'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_is_work_email_verified(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_verifications wv
    WHERE wv.user_id = p_uid
      AND wv.status = 'verified'
      AND (wv.expires_at IS NULL OR wv.expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_is_work_email_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_is_work_email_verified(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleaner_city_is_work_email_verified(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_commute_profile(
  p_role text DEFAULT 'both',
  p_transport_preference text DEFAULT 'looking',
  p_company_name text DEFAULT NULL,
  p_is_paused boolean DEFAULT false
)
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;

  IF NOT public.can_access_feature(v_society, 'cleaner_city') AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'A Cleaner City is not enabled for this society';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('host', 'guest', 'both') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF p_transport_preference IS NULL OR p_transport_preference NOT IN ('car', 'bike', 'looking') THEN
    RAISE EXCEPTION 'Invalid transport preference';
  END IF;

  INSERT INTO public.commute_profiles AS cp (
    user_id, society_id, role, transport_preference, company_name, is_paused, deleted_at, updated_at
  )
  VALUES (
    v_uid, v_society, p_role, p_transport_preference,
    NULLIF(trim(COALESCE(p_company_name, '')), ''),
    COALESCE(p_is_paused, false),
    NULL,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    society_id = EXCLUDED.society_id,
    role = EXCLUDED.role,
    transport_preference = EXCLUDED.transport_preference,
    company_name = EXCLUDED.company_name,
    is_paused = EXCLUDED.is_paused,
    deleted_at = NULL,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_commute_profile(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_commute_profile(text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_soft_delete_commute_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.commute_profiles
  SET deleted_at = now(), is_paused = true, updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_soft_delete_commute_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_soft_delete_commute_profile() TO authenticated;

-- Called by edge function with service role after hashing OTP.
CREATE OR REPLACE FUNCTION public.cleaner_city_store_work_email_otp(
  p_user_id uuid,
  p_email text,
  p_otp_hash text,
  p_otp_expires_at timestamptz
)
RETURNS public.work_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid;
  v_domain text;
  v_domain_id uuid;
  v_row public.work_verifications;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL OR p_otp_hash IS NULL THEN
    RAISE EXCEPTION 'Missing OTP fields';
  END IF;

  v_society := public.get_user_society_id(p_user_id);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;

  IF NOT public.can_access_feature(v_society, 'cleaner_city') AND NOT public.is_admin(p_user_id) THEN
    RAISE EXCEPTION 'A Cleaner City is not enabled for this society';
  END IF;

  v_domain := lower(split_part(trim(p_email), '@', 2));
  IF v_domain IS NULL OR v_domain = '' OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  IF public.cleaner_city_is_personal_or_disposable_domain(v_domain) THEN
    RAISE EXCEPTION 'Personal or disposable email domains are not eligible for work email verification';
  END IF;

  SELECT id INTO v_domain_id
  FROM public.company_domains
  WHERE lower(domain) = v_domain AND status = 'approved'
  LIMIT 1;

  IF v_domain_id IS NULL THEN
    RAISE EXCEPTION 'Email domain is not an approved corporate domain';
  END IF;

  -- Changing email after verified requires a fresh pending row (revoke old verified).
  UPDATE public.work_verifications
  SET status = 'revoked', updated_at = now(), otp_hash = NULL
  WHERE user_id = p_user_id
    AND status = 'verified'
    AND lower(email) <> lower(trim(p_email));

  SELECT * INTO v_row
  FROM public.work_verifications
  WHERE user_id = p_user_id AND lower(email) = lower(trim(p_email))
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    INSERT INTO public.work_verifications (
      user_id, society_id, email, domain_id, status,
      otp_hash, otp_expires_at, otp_attempt_count, last_otp_sent_at
    )
    VALUES (
      p_user_id, v_society, lower(trim(p_email)), v_domain_id, 'pending',
      p_otp_hash, p_otp_expires_at, 0, now()
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.work_verifications
    SET
      society_id = v_society,
      domain_id = v_domain_id,
      status = 'pending',
      verified_at = NULL,
      expires_at = NULL,
      otp_hash = p_otp_hash,
      otp_expires_at = p_otp_expires_at,
      otp_attempt_count = 0,
      last_otp_sent_at = now(),
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_store_work_email_otp(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_store_work_email_otp(uuid, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_verify_work_email_otp(
  p_email text,
  p_otp_hash text
)
RETURNS public.work_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.work_verifications;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.work_verifications
  WHERE user_id = v_uid
    AND lower(email) = lower(trim(p_email))
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No verification challenge found';
  END IF;

  IF v_row.otp_expires_at IS NULL OR v_row.otp_expires_at < now() THEN
    UPDATE public.work_verifications
    SET status = 'expired', updated_at = now()
    WHERE id = v_row.id;
    RAISE EXCEPTION 'OTP expired';
  END IF;

  IF COALESCE(v_row.otp_attempt_count, 0) >= 5 THEN
    RAISE EXCEPTION 'Too many OTP attempts';
  END IF;

  IF v_row.otp_hash IS DISTINCT FROM p_otp_hash THEN
    UPDATE public.work_verifications
    SET otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1, updated_at = now()
    WHERE id = v_row.id;
    RAISE EXCEPTION 'Invalid OTP';
  END IF;

  -- Revoke other verified rows for this user
  UPDATE public.work_verifications
  SET status = 'revoked', otp_hash = NULL, updated_at = now()
  WHERE user_id = v_uid AND id <> v_row.id AND status = 'verified';

  UPDATE public.work_verifications
  SET
    status = 'verified',
    verified_at = now(),
    expires_at = now() + interval '365 days',
    otp_hash = NULL,
    otp_expires_at = NULL,
    otp_attempt_count = 0,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Edge verifies by hashing client-submitted code then calling this via user JWT.
-- Also expose a service-role verify that accepts plaintext hash comparison after edge hashes.
CREATE OR REPLACE FUNCTION public.cleaner_city_verify_work_email_otp_hash(
  p_user_id uuid,
  p_email text,
  p_otp_hash text
)
RETURNS public.work_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.work_verifications;
BEGIN
  SELECT * INTO v_row
  FROM public.work_verifications
  WHERE user_id = p_user_id
    AND lower(email) = lower(trim(p_email))
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No verification challenge found';
  END IF;

  IF v_row.otp_expires_at IS NULL OR v_row.otp_expires_at < now() THEN
    UPDATE public.work_verifications SET status = 'expired', updated_at = now() WHERE id = v_row.id;
    RAISE EXCEPTION 'OTP expired';
  END IF;

  IF COALESCE(v_row.otp_attempt_count, 0) >= 5 THEN
    RAISE EXCEPTION 'Too many OTP attempts';
  END IF;

  IF v_row.otp_hash IS DISTINCT FROM p_otp_hash THEN
    UPDATE public.work_verifications
    SET otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1, updated_at = now()
    WHERE id = v_row.id;
    RAISE EXCEPTION 'Invalid OTP';
  END IF;

  UPDATE public.work_verifications
  SET status = 'revoked', otp_hash = NULL, updated_at = now()
  WHERE user_id = p_user_id AND id <> v_row.id AND status = 'verified';

  UPDATE public.work_verifications
  SET
    status = 'verified',
    verified_at = now(),
    expires_at = now() + interval '365 days',
    otp_hash = NULL,
    otp_expires_at = NULL,
    otp_attempt_count = 0,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_verify_work_email_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_verify_work_email_otp(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.cleaner_city_verify_work_email_otp_hash(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_verify_work_email_otp_hash(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_upsert_company_domain(
  p_domain text,
  p_company_name text,
  p_status text DEFAULT 'approved',
  p_notes text DEFAULT NULL
)
RETURNS public.company_domains
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_domain text;
  v_row public.company_domains;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  v_domain := lower(trim(p_domain));
  IF v_domain IS NULL OR v_domain = '' THEN
    RAISE EXCEPTION 'Domain required';
  END IF;
  IF public.cleaner_city_is_personal_or_disposable_domain(v_domain) THEN
    RAISE EXCEPTION 'Cannot approve personal or disposable domains';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  INSERT INTO public.company_domains AS cd (
    domain, company_name, status, notes, created_by, reviewed_by, reviewed_at, updated_at
  )
  VALUES (
    v_domain,
    trim(p_company_name),
    p_status,
    p_notes,
    v_uid,
    CASE WHEN p_status IN ('approved', 'rejected') THEN v_uid ELSE NULL END,
    CASE WHEN p_status IN ('approved', 'rejected') THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (domain) DO UPDATE SET
    company_name = EXCLUDED.company_name,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    reviewed_by = CASE WHEN EXCLUDED.status IN ('approved', 'rejected') THEN v_uid ELSE cd.reviewed_by END,
    reviewed_at = CASE WHEN EXCLUDED.status IN ('approved', 'rejected') THEN now() ELSE cd.reviewed_at END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_upsert_company_domain(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_upsert_company_domain(text, text, text, text) TO authenticated;

-- Gate helper used by later publish/book RPCs
CREATE OR REPLACE FUNCTION public.cleaner_city_require_verified_commuter(p_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.cleaner_city_is_work_email_verified(p_uid) THEN
    RAISE EXCEPTION 'Work email must be verified before ride participation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commute_profiles cp
    WHERE cp.user_id = p_uid AND cp.deleted_at IS NULL AND cp.is_paused = false
  ) THEN
    RAISE EXCEPTION 'Active commute profile required';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_require_verified_commuter(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_require_verified_commuter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleaner_city_require_verified_commuter(uuid) TO service_role;

COMMENT ON FUNCTION public.cleaner_city_require_verified_commuter(uuid) IS
  'Unit 2 exit gate: unverified accounts cannot publish or book rides.';
