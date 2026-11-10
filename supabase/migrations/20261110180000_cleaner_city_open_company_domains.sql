-- Accept any non-personal work email domain.
-- Derive company name from the email domain (sociva.in -> sociva, tcs.com -> tcs).
-- Auto-register domains as approved so OTP store still has a domain_id.

CREATE OR REPLACE FUNCTION public.cleaner_city_company_name_from_domain(p_domain text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(trim(COALESCE(p_domain, '')));
  v_parts text[];
  v_slug text;
BEGIN
  IF v_domain = '' OR position('.' IN v_domain) = 0 THEN
    RETURN NULL;
  END IF;
  v_parts := string_to_array(v_domain, '.');
  IF array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 2 THEN
    RETURN NULL;
  END IF;
  -- tcs.com -> tcs; mail.tcs.com / www.sociva.in -> tcs / sociva
  IF array_length(v_parts, 1) = 2 THEN
    v_slug := v_parts[1];
  ELSE
    v_slug := v_parts[array_length(v_parts, 1) - 1];
  END IF;
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN NULL;
  END IF;
  RETURN lower(v_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_company_name_from_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_company_name_from_domain(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_ensure_company_domain(p_domain text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(trim(COALESCE(p_domain, '')));
  v_company text;
  v_id uuid;
BEGIN
  IF v_domain = '' THEN
    RAISE EXCEPTION 'Invalid domain';
  END IF;
  IF public.cleaner_city_is_personal_or_disposable_domain(v_domain) THEN
    RAISE EXCEPTION 'Personal or disposable email domains are not eligible for work email verification';
  END IF;

  v_company := public.cleaner_city_company_name_from_domain(v_domain);
  IF v_company IS NULL OR char_length(v_company) < 2 THEN
    RAISE EXCEPTION 'Could not derive company name from domain';
  END IF;

  SELECT id INTO v_id
  FROM public.company_domains
  WHERE lower(domain) = v_domain
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.company_domains
    SET
      status = 'approved',
      company_name = COALESCE(NULLIF(trim(company_name), ''), v_company),
      notes = COALESCE(notes, 'Auto-approved from work email'),
      updated_at = now()
    WHERE id = v_id
      AND status IS DISTINCT FROM 'approved';
    RETURN v_id;
  END IF;

  INSERT INTO public.company_domains (domain, company_name, status, notes)
  VALUES (v_domain, v_company, 'approved', 'Auto-approved from work email')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_ensure_company_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_ensure_company_domain(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_check_work_email_domain(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text;
  v_company text;
  v_stored text;
  v_role text := coalesce(auth.role(), current_setting('role', true), '');
  v_user text := current_user;
BEGIN
  IF auth.uid() IS NULL
     AND v_role IS DISTINCT FROM 'service_role'
     AND v_user NOT IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  p_email := lower(trim(COALESCE(p_email, '')));
  IF p_email = '' OR position('@' IN p_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_email', 'message', 'Enter a valid work email address');
  END IF;
  v_domain := lower(split_part(p_email, '@', 2));
  IF v_domain = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_email', 'message', 'Enter a valid work email address');
  END IF;
  IF public.cleaner_city_is_personal_or_disposable_domain(v_domain) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'personal_email',
      'domain', v_domain,
      'message', 'Personal inboxes like Gmail or Yahoo are not allowed. Use your company email.'
    );
  END IF;

  v_company := public.cleaner_city_company_name_from_domain(v_domain);
  IF v_company IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'invalid_email',
      'domain', v_domain,
      'message', 'Enter a valid work email address'
    );
  END IF;

  -- Prefer a nicer stored company label when already known.
  SELECT NULLIF(trim(company_name), '')
  INTO v_stored
  FROM public.company_domains
  WHERE lower(domain) = v_domain
  LIMIT 1;
  v_company := COALESCE(v_stored, v_company);

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'approved',
    'domain', v_domain,
    'company_name', v_company,
    'message', format('Company detected: %s', v_company)
  );
END;
$$;

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

  v_domain_id := public.cleaner_city_ensure_company_domain(v_domain);

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
