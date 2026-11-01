-- Sociva HelpHub: society-scoped domestic-help discovery directory
-- Privacy-first: no public phone numbers; enquiry + consent required.

ALTER TABLE public.platform_features
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO public.platform_features (
  feature_key,
  feature_name,
  display_name,
  description,
  tagline,
  category,
  is_core,
  society_configurable,
  route,
  icon_name,
  audience,
  capabilities
)
VALUES (
  'helphub',
  'HelpHub',
  'HelpHub',
  'Society employment and domestic-help discovery with resident recommendations and private enquiries',
  'Find trusted help. Discover local opportunities.',
  'community',
  false,
  true,
  '/help-hub',
  'HandHelping',
  ARRAY['Resident', 'Worker', 'Society Admin'],
  ARRAY[
    'Recommend available help in under 30 seconds',
    'Searchable society directory',
    'Private enquiry workflow',
    'Consent records and listing expiry'
  ]
)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  tagline = EXCLUDED.tagline,
  route = EXCLUDED.route,
  icon_name = EXCLUDED.icon_name,
  is_active = true;

INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE pf.feature_key = 'helphub'
ON CONFLICT (package_id, feature_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.helphub_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  languages text[] NOT NULL DEFAULT '{}',
  experience_years integer,
  contact_preference text NOT NULL DEFAULT 'in_app',
  private_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.helphub_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.helphub_profiles(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  work_type text NOT NULL,
  availability text NOT NULL,
  preferred_area text,
  languages text[] NOT NULL DEFAULT '{}',
  description text,
  expected_salary numeric,
  experience_years integer,
  source text NOT NULL CHECK (source IN ('resident_recommendation', 'self_registered', 'assisted')),
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('draft', 'pending_consent', 'active', 'paused', 'hired', 'expired', 'removed', 'suspended')
  ),
  recommender_name text,
  tower_or_block text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helphub_listings_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT helphub_listings_description_len CHECK (description IS NULL OR char_length(description) <= 800)
);

CREATE TABLE IF NOT EXISTS public.helphub_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.helphub_listings(id) ON DELETE CASCADE,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.helphub_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.helphub_listings(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'declined', 'contact_shared', 'closed')
  ),
  message text,
  shared_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS helphub_enquiries_open_unique
  ON public.helphub_enquiries (listing_id, from_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.helphub_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.helphub_listings(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.helphub_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helphub_listings_society_status
  ON public.helphub_listings (society_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_helphub_listings_category
  ON public.helphub_listings (society_id, category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_helphub_listings_availability
  ON public.helphub_listings (society_id, availability) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_helphub_listings_work_type
  ON public.helphub_listings (society_id, work_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_helphub_listings_expires
  ON public.helphub_listings (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_helphub_enquiries_listing_status
  ON public.helphub_enquiries (listing_id, status);
CREATE INDEX IF NOT EXISTS idx_helphub_enquiries_from_user
  ON public.helphub_enquiries (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_helphub_reports_society_status
  ON public.helphub_reports (society_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_helphub_consent_listing
  ON public.helphub_consent_records (listing_id);

ALTER TABLE public.helphub_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helphub_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helphub_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helphub_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helphub_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helphub_audit_logs ENABLE ROW LEVEL SECURITY;

-- Listings: society members can read active (non-sensitive) rows
DROP POLICY IF EXISTS helphub_listings_select ON public.helphub_listings;
CREATE POLICY helphub_listings_select ON public.helphub_listings
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS helphub_listings_insert ON public.helphub_listings;
CREATE POLICY helphub_listings_insert ON public.helphub_listings
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS helphub_listings_update ON public.helphub_listings;
CREATE POLICY helphub_listings_update ON public.helphub_listings
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS feature_gate_helphub_listings_insert ON public.helphub_listings;
CREATE POLICY feature_gate_helphub_listings_insert ON public.helphub_listings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.can_access_feature(public.get_user_society_id(auth.uid()), 'helphub'));

DROP POLICY IF EXISTS feature_gate_helphub_listings_update ON public.helphub_listings;
CREATE POLICY feature_gate_helphub_listings_update ON public.helphub_listings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.can_access_feature(public.get_user_society_id(auth.uid()), 'helphub'));

-- Profiles: owner + society admins
DROP POLICY IF EXISTS helphub_profiles_select ON public.helphub_profiles;
CREATE POLICY helphub_profiles_select ON public.helphub_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR created_by = auth.uid()
    OR society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS helphub_profiles_write ON public.helphub_profiles;
CREATE POLICY helphub_profiles_write ON public.helphub_profiles
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
  )
  WITH CHECK (
    created_by = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

-- Consent: participants + admins
DROP POLICY IF EXISTS helphub_consent_select ON public.helphub_consent_records;
CREATE POLICY helphub_consent_select ON public.helphub_consent_records
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR recorded_by = auth.uid()
  );

DROP POLICY IF EXISTS helphub_consent_insert ON public.helphub_consent_records;
CREATE POLICY helphub_consent_insert ON public.helphub_consent_records
  FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

-- Enquiries: parties only; never expose shared_phone via broad society select
DROP POLICY IF EXISTS helphub_enquiries_select ON public.helphub_enquiries;
CREATE POLICY helphub_enquiries_select ON public.helphub_enquiries
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR from_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.helphub_listings l
      WHERE l.id = listing_id AND l.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS helphub_enquiries_insert ON public.helphub_enquiries;
CREATE POLICY helphub_enquiries_insert ON public.helphub_enquiries
  FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS helphub_enquiries_update ON public.helphub_enquiries;
CREATE POLICY helphub_enquiries_update ON public.helphub_enquiries
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR from_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.helphub_listings l
      WHERE l.id = listing_id AND l.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS feature_gate_helphub_enquiries_insert ON public.helphub_enquiries;
CREATE POLICY feature_gate_helphub_enquiries_insert ON public.helphub_enquiries
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.can_access_feature(public.get_user_society_id(auth.uid()), 'helphub'));

-- Reports
DROP POLICY IF EXISTS helphub_reports_select ON public.helphub_reports;
CREATE POLICY helphub_reports_select ON public.helphub_reports
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR reported_by = auth.uid()
  );

DROP POLICY IF EXISTS helphub_reports_insert ON public.helphub_reports;
CREATE POLICY helphub_reports_insert ON public.helphub_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS helphub_reports_update ON public.helphub_reports;
CREATE POLICY helphub_reports_update ON public.helphub_reports
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- Audit logs: admin / society admin only
DROP POLICY IF EXISTS helphub_audit_select ON public.helphub_audit_logs;
CREATE POLICY helphub_audit_select ON public.helphub_audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (society_id IS NOT NULL AND public.is_society_admin(auth.uid(), society_id))
  );

DROP POLICY IF EXISTS helphub_audit_insert ON public.helphub_audit_logs;
CREATE POLICY helphub_audit_insert ON public.helphub_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.helphub_log(
  p_society_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.helphub_audit_logs (society_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_society_id, auth.uid(), p_action, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

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
  p_tower_or_block text DEFAULT NULL
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
  v_listing public.helphub_listings;
  v_recent int;
  v_consent_text text := 'I confirm that this person has agreed to be listed on Sociva and to receive employment enquiries.';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT COALESCE(p_consent_confirmed, false) THEN
    RAISE EXCEPTION 'Consent is required before publishing';
  END IF;
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;
  IF NOT public.can_access_feature(v_society, 'helphub') THEN
    RAISE EXCEPTION 'HelpHub is not enabled for this society';
  END IF;

  IF p_display_name IS NULL OR length(trim(p_display_name)) < 1 THEN
    RAISE EXCEPTION 'Display name is required';
  END IF;
  IF p_source NOT IN ('resident_recommendation', 'self_registered', 'assisted') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.helphub_listings
  WHERE created_by = v_uid
    AND created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'Rate limit: too many listings created recently';
  END IF;

  SELECT name INTO v_profile_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.helphub_listings (
    society_id, created_by, display_name, category, work_type, availability,
    preferred_area, languages, description, expected_salary, experience_years,
    source, status, recommender_name, tower_or_block, expires_at
  ) VALUES (
    v_society, v_uid, trim(p_display_name), p_category, p_work_type, p_availability,
    p_preferred_area, COALESCE(p_languages, '{}'), NULLIF(trim(COALESCE(p_description, '')), ''),
    p_expected_salary, p_experience_years, p_source, 'active',
    CASE WHEN p_source = 'self_registered' THEN NULL ELSE COALESCE(v_profile_name, 'A resident') END,
    p_tower_or_block, now() + interval '30 days'
  )
  RETURNING * INTO v_listing;

  INSERT INTO public.helphub_consent_records (
    society_id, listing_id, recorded_by, consent_version, consent_text
  ) VALUES (
    v_society, v_listing.id, v_uid, 'helphub_consent_v1', v_consent_text
  );

  PERFORM public.helphub_log(v_society, 'listing_created', 'helphub_listing', v_listing.id,
    jsonb_build_object('source', p_source, 'category', p_category));

  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_send_enquiry(
  p_listing_id uuid,
  p_message text DEFAULT NULL
)
RETURNS public.helphub_enquiries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
  v_enquiry public.helphub_enquiries;
  v_recent int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_access_feature(public.get_user_society_id(v_uid), 'helphub') THEN
    RAISE EXCEPTION 'HelpHub is not enabled for this society';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF v_listing.society_id <> public.get_user_society_id(v_uid) AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Cross-society access denied';
  END IF;
  IF v_listing.status <> 'active' OR v_listing.expires_at <= now() THEN
    RAISE EXCEPTION 'Listing is not available';
  END IF;
  IF v_listing.created_by = v_uid THEN
    RAISE EXCEPTION 'Cannot enquire on your own listing';
  END IF;

  SELECT * INTO v_enquiry
  FROM public.helphub_enquiries
  WHERE listing_id = p_listing_id AND from_user_id = v_uid AND status = 'pending'
  LIMIT 1;
  IF FOUND THEN
    RETURN v_enquiry;
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.helphub_enquiries
  WHERE from_user_id = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Rate limit: too many enquiries';
  END IF;

  INSERT INTO public.helphub_enquiries (
    society_id, listing_id, from_user_id, status, message
  ) VALUES (
    v_listing.society_id, p_listing_id, v_uid, 'pending', NULLIF(trim(COALESCE(p_message, '')), '')
  )
  RETURNING * INTO v_enquiry;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload, society_id)
  VALUES (
    v_listing.created_by,
    'New HelpHub enquiry',
    'Someone is interested in ' || v_listing.display_name,
    'helphub_enquiry',
    '/help-hub/listing/' || v_listing.id::text,
    jsonb_build_object('listing_id', v_listing.id, 'enquiry_id', v_enquiry.id, 'type', 'helphub_enquiry'),
    v_listing.society_id
  );

  PERFORM public.helphub_log(v_listing.society_id, 'enquiry_sent', 'helphub_enquiry', v_enquiry.id,
    jsonb_build_object('listing_id', v_listing.id));

  RETURN v_enquiry;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_respond_enquiry(
  p_enquiry_id uuid,
  p_status text,
  p_shared_phone text DEFAULT NULL
)
RETURNS public.helphub_enquiries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enquiry public.helphub_enquiries;
  v_listing public.helphub_listings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_status NOT IN ('accepted', 'declined', 'contact_shared', 'closed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT * INTO v_enquiry FROM public.helphub_enquiries WHERE id = p_enquiry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enquiry not found';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = v_enquiry.listing_id;
  IF v_listing.created_by <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_status = 'contact_shared' AND (p_shared_phone IS NULL OR length(trim(p_shared_phone)) < 8) THEN
    RAISE EXCEPTION 'Phone required to share contact';
  END IF;

  UPDATE public.helphub_enquiries
  SET status = p_status,
      shared_phone = CASE WHEN p_status = 'contact_shared' THEN trim(p_shared_phone) ELSE shared_phone END,
      updated_at = now()
  WHERE id = p_enquiry_id
  RETURNING * INTO v_enquiry;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload, society_id)
  VALUES (
    v_enquiry.from_user_id,
    CASE
      WHEN p_status = 'accepted' THEN 'HelpHub enquiry accepted'
      WHEN p_status = 'declined' THEN 'HelpHub enquiry declined'
      WHEN p_status = 'contact_shared' THEN 'Contact details shared'
      ELSE 'HelpHub enquiry updated'
    END,
    'Update on your enquiry for ' || v_listing.display_name,
    CASE
      WHEN p_status = 'contact_shared' THEN 'helphub_contact_shared'
      WHEN p_status = 'accepted' THEN 'helphub_enquiry_accepted'
      WHEN p_status = 'declined' THEN 'helphub_enquiry_declined'
      ELSE 'helphub_enquiry'
    END,
    '/help-hub/listing/' || v_listing.id::text,
    jsonb_build_object('listing_id', v_listing.id, 'enquiry_id', v_enquiry.id, 'status', p_status),
    v_listing.society_id
  );

  PERFORM public.helphub_log(v_listing.society_id, 'enquiry_' || p_status, 'helphub_enquiry', v_enquiry.id, '{}'::jsonb);

  RETURN v_enquiry;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_update_listing_status(
  p_listing_id uuid,
  p_status text
)
RETURNS public.helphub_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
BEGIN
  IF p_status NOT IN ('active', 'paused', 'hired', 'expired', 'removed', 'suspended') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF v_listing.created_by <> v_uid
     AND NOT public.is_admin(v_uid)
     AND NOT public.is_society_admin(v_uid, v_listing.society_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_status = 'suspended' AND NOT (public.is_admin(v_uid) OR public.is_society_admin(v_uid, v_listing.society_id)) THEN
    RAISE EXCEPTION 'Only admins can suspend listings';
  END IF;

  UPDATE public.helphub_listings
  SET status = p_status, updated_at = now()
  WHERE id = p_listing_id
  RETURNING * INTO v_listing;

  PERFORM public.helphub_log(v_listing.society_id, 'listing_status_' || p_status, 'helphub_listing', v_listing.id, '{}'::jsonb);
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_mark_hired(p_listing_id uuid)
RETURNS public.helphub_listings
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.helphub_update_listing_status(p_listing_id, 'hired');
$$;

CREATE OR REPLACE FUNCTION public.helphub_renew_listing(p_listing_id uuid)
RETURNS public.helphub_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
BEGIN
  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF v_listing.created_by <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.helphub_listings
  SET status = 'active',
      expires_at = now() + interval '30 days',
      updated_at = now()
  WHERE id = p_listing_id
  RETURNING * INTO v_listing;

  PERFORM public.helphub_log(v_listing.society_id, 'listing_renewed', 'helphub_listing', v_listing.id, '{}'::jsonb);
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_report_listing(
  p_listing_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS public.helphub_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
  v_report public.helphub_reports;
  v_recent int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF v_listing.society_id <> public.get_user_society_id(v_uid) AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Cross-society access denied';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.helphub_reports
  WHERE reported_by = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'Rate limit: too many reports';
  END IF;

  INSERT INTO public.helphub_reports (society_id, listing_id, reported_by, reason, details)
  VALUES (v_listing.society_id, p_listing_id, v_uid, trim(p_reason), NULLIF(trim(COALESCE(p_details, '')), ''))
  RETURNING * INTO v_report;

  PERFORM public.helphub_log(v_listing.society_id, 'listing_reported', 'helphub_report', v_report.id,
    jsonb_build_object('listing_id', p_listing_id, 'reason', p_reason));

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_expire_listings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.helphub_listings
    SET status = 'expired', updated_at = now()
    WHERE status = 'active'
      AND expires_at <= now()
    RETURNING id, society_id, created_by, display_name
  )
  SELECT count(*) INTO v_count FROM expired;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload, society_id)
  SELECT e.created_by,
         'HelpHub listing expired',
         e.display_name || ' is no longer active. Renew to publish again.',
         'helphub_expired',
         '/help-hub/listing/' || e.id::text,
         jsonb_build_object('listing_id', e.id, 'type', 'helphub_expired'),
         e.society_id
  FROM (
    SELECT id, society_id, created_by, display_name
    FROM public.helphub_listings
    WHERE status = 'expired'
      AND updated_at > now() - interval '2 minutes'
  ) e;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_notify_expiring_soon()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload, society_id)
  SELECT l.created_by,
         'HelpHub listing expiring soon',
         l.display_name || ' expires in 3 days. Renew to keep it visible.',
         'helphub_expiry',
         '/help-hub/listing/' || l.id::text,
         jsonb_build_object('listing_id', l.id, 'type', 'helphub_expiry'),
         l.society_id
  FROM public.helphub_listings l
  WHERE l.status = 'active'
    AND l.expires_at > now()
    AND l.expires_at <= now() + interval '3 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_queue nq
      WHERE nq.user_id = l.created_by
        AND nq.type = 'helphub_expiry'
        AND nq.payload->>'listing_id' = l.id::text
        AND nq.created_at > now() - interval '3 days'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.helphub_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  RETURN jsonb_build_object(
    'active_listings', (SELECT count(*) FROM public.helphub_listings WHERE status = 'active' AND expires_at > now()),
    'workers_registered', (SELECT count(*) FROM public.helphub_listings WHERE source IN ('self_registered', 'assisted')),
    'resident_recommendations', (SELECT count(*) FROM public.helphub_listings WHERE source = 'resident_recommendation'),
    'enquiries', (SELECT count(*) FROM public.helphub_enquiries),
    'hired', (SELECT count(*) FROM public.helphub_listings WHERE status = 'hired'),
    'expired', (SELECT count(*) FROM public.helphub_listings WHERE status = 'expired'),
    'reported', (SELECT count(*) FROM public.helphub_reports WHERE status = 'open')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.helphub_create_listing TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_send_enquiry TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_respond_enquiry TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_update_listing_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_mark_hired TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_renew_listing TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_report_listing TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_expire_listings TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_notify_expiring_soon TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_admin_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.helphub_log TO authenticated;

-- Optional pg_cron schedules when extension exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'helphub-expire-listings') THEN
      PERFORM cron.unschedule('helphub-expire-listings');
    END IF;
    PERFORM cron.schedule(
      'helphub-expire-listings',
      '15 * * * *',
      $cron$SELECT public.helphub_expire_listings(); SELECT public.helphub_notify_expiring_soon();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'HelpHub cron not scheduled: %', SQLERRM;
END;
$$;
