-- HelpHub: typical daily hours (from / to) alongside period chips

ALTER TABLE public.helphub_listings
  ADD COLUMN IF NOT EXISTS available_from time,
  ADD COLUMN IF NOT EXISTS available_to time;

GRANT SELECT (available_from, available_to) ON public.helphub_listings TO authenticated;
GRANT INSERT (available_from, available_to) ON public.helphub_listings TO authenticated;
GRANT UPDATE (available_from, available_to) ON public.helphub_listings TO authenticated;

-- Collapse older overloads so PostgREST resolves a single create RPC
DROP FUNCTION IF EXISTS public.helphub_create_listing(text, text, text, text, text, text[], text, numeric, integer, text, boolean, text);
DROP FUNCTION IF EXISTS public.helphub_create_listing(text, text, text, text, text, text[], text, numeric, integer, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.helphub_create_listing(text, text, text, text, text, text[], text, numeric, integer, text, boolean, text, text, text);

CREATE OR REPLACE FUNCTION public.helphub_create_listing(
  p_display_name text,
  p_category text,
  p_work_type text,
  p_availability text,
  p_preferred_area text DEFAULT NULL,
  p_languages text[] DEFAULT '{}',
  p_description text DEFAULT NULL,
  p_expected_salary numeric DEFAULT NULL,
  p_experience_years integer DEFAULT NULL,
  p_source text DEFAULT 'resident_recommendation',
  p_consent_confirmed boolean DEFAULT false,
  p_tower_or_block text DEFAULT NULL,
  p_private_phone text DEFAULT NULL,
  p_recommender_flat text DEFAULT NULL,
  p_available_from text DEFAULT NULL,
  p_available_to text DEFAULT NULL
)
RETURNS public.helphub_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_profile_name text;
  v_profile_flat text;
  v_listing public.helphub_listings;
  v_recent int;
  v_phone text;
  v_from time;
  v_to time;
  v_consent_text text := 'I confirm that this person has agreed to be listed on Sociva and to receive employment enquiries.';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT COALESCE(p_consent_confirmed, false) THEN RAISE EXCEPTION 'Consent is required before publishing'; END IF;
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN RAISE EXCEPTION 'Society membership required'; END IF;
  IF NOT public.can_access_feature(v_society, 'helphub') THEN RAISE EXCEPTION 'HelpHub is not enabled for this society'; END IF;
  IF p_display_name IS NULL OR length(trim(p_display_name)) < 1 THEN RAISE EXCEPTION 'Display name is required'; END IF;
  IF p_source NOT IN ('resident_recommendation', 'self_registered', 'assisted') THEN RAISE EXCEPTION 'Invalid source'; END IF;

  v_phone := regexp_replace(COALESCE(p_private_phone, ''), '\D', '', 'g');
  IF length(v_phone) = 12 AND left(v_phone, 2) = '91' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone IS NULL OR length(v_phone) <> 10 OR v_phone !~ '^[6-9]' THEN
    RAISE EXCEPTION 'Valid 10-digit mobile number is required';
  END IF;

  BEGIN
    v_from := CASE
      WHEN p_available_from IS NULL OR length(trim(p_available_from)) = 0 THEN NULL
      ELSE trim(p_available_from)::time
    END;
    v_to := CASE
      WHEN p_available_to IS NULL OR length(trim(p_available_to)) = 0 THEN NULL
      ELSE trim(p_available_to)::time
    END;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Enter valid times like 07:00 and 11:00';
  END;

  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from = v_to THEN
    RAISE EXCEPTION 'End time should be different from start time';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.helphub_listings
  WHERE created_by = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN RAISE EXCEPTION 'Rate limit: too many listings created recently'; END IF;

  SELECT name, flat_number INTO v_profile_name, v_profile_flat
  FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.helphub_listings (
    society_id, created_by, display_name, category, work_type, availability,
    available_from, available_to,
    preferred_area, languages, description, expected_salary, experience_years,
    source, status, recommender_name, recommender_flat, tower_or_block, expires_at, private_phone
  ) VALUES (
    v_society, v_uid, trim(p_display_name), p_category, p_work_type, p_availability,
    v_from, v_to,
    p_preferred_area, COALESCE(p_languages, '{}'), NULLIF(trim(COALESCE(p_description, '')), ''),
    p_expected_salary, p_experience_years, p_source, 'active',
    CASE WHEN p_source = 'self_registered' THEN NULL ELSE COALESCE(v_profile_name, 'A resident') END,
    CASE WHEN p_source = 'self_registered' THEN NULL
         ELSE COALESCE(NULLIF(trim(COALESCE(p_recommender_flat, '')), ''), v_profile_flat) END,
    p_tower_or_block, now() + interval '30 days', v_phone
  ) RETURNING * INTO v_listing;

  INSERT INTO public.helphub_consent_records (society_id, listing_id, recorded_by, consent_version, consent_text)
  VALUES (v_society, v_listing.id, v_uid, 'helphub_consent_v1', v_consent_text);

  PERFORM public.helphub_log(
    v_society, 'listing_created', 'helphub_listing', v_listing.id,
    jsonb_build_object('source', p_source, 'category', p_category)
  );

  v_listing.private_phone := NULL;
  RETURN v_listing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.helphub_create_listing(
  text, text, text, text, text, text[], text, numeric, integer, text, boolean, text, text, text, text, text
) TO authenticated;
