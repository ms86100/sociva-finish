-- Resident domain list, email domain check, and request-pending domain.

CREATE OR REPLACE FUNCTION public.cleaner_city_list_approved_domains()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'domain', d.domain,
      'company_name', d.company_name
    ) ORDER BY d.company_name, d.domain)
    FROM public.company_domains d
    WHERE d.status = 'approved'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_list_approved_domains() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_list_approved_domains() TO authenticated;

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
  v_status text;
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
  SELECT company_name, status INTO v_company, v_status
  FROM public.company_domains
  WHERE lower(domain) = v_domain
  LIMIT 1;
  IF v_status = 'approved' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'approved',
      'domain', v_domain,
      'company_name', v_company,
      'message', 'Domain approved - you can send a verification code'
    );
  END IF;
  IF v_status = 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'domain_pending',
      'domain', v_domain,
      'company_name', v_company,
      'message', 'This company domain is waiting for admin approval. You will be able to verify once it is approved.'
    );
  END IF;
  IF v_status = 'rejected' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'domain_rejected',
      'domain', v_domain,
      'message', 'This domain was rejected. Ask your society admin for help.'
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', false,
    'code', 'domain_not_approved',
    'domain', v_domain,
    'message', 'This company domain is not approved yet. Request approval below or ask an admin.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_check_work_email_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_check_work_email_domain(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_request_company_domain(
  p_domain text,
  p_company_name text
)
RETURNS public.company_domains
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_domain text;
  v_company text;
  v_row public.company_domains;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_domain := lower(trim(COALESCE(p_domain, '')));
  v_company := trim(COALESCE(p_company_name, ''));
  IF v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid domain like company.com';
  END IF;
  IF char_length(v_company) < 2 THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;
  IF public.cleaner_city_is_personal_or_disposable_domain(v_domain) THEN
    RAISE EXCEPTION 'Personal email domains cannot be requested';
  END IF;

  SELECT * INTO v_row FROM public.company_domains WHERE lower(domain) = v_domain;
  IF v_row.id IS NOT NULL THEN
    IF v_row.status IN ('approved', 'pending') THEN
      RETURN v_row;
    END IF;
    UPDATE public.company_domains
    SET status = 'pending', company_name = v_company, notes = 'Re-requested by resident',
        created_by = v_uid, updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  INSERT INTO public.company_domains (domain, company_name, status, notes, created_by)
  VALUES (v_domain, v_company, 'pending', 'Requested by resident', v_uid)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_request_company_domain(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_company_domain(text, text) TO authenticated;
