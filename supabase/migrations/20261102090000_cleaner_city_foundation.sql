-- Sociva A Cleaner City - Unit 1 foundation
-- Feature flag, PostGIS, core tables, RLS, neighbour graph, match-scope helper.
-- No ride matching, OTP email, or booking behaviour in this migration.

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- Ensure postgis types are usable from public
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'postgis'
  ) THEN
    RAISE EXCEPTION 'PostGIS extension required for cleaner_city foundation';
  END IF;
END;
$$;

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
  'cleaner_city',
  'A Cleaner City',
  'A Cleaner City',
  'Society-first corporate commute sharing with verified work email, route matching and fuel cost sharing',
  'Your daily commute. Shared with your community.',
  'community',
  false,
  true,
  '/cleaner-city',
  'Leaf',
  ARRAY['Resident', 'Society Admin', 'Platform Admin'],
  ARRAY[
    'Verified neighbour commute discovery',
    'Flexible schedules and daily overrides',
    'Route-overlap matching for cars and bikes',
    'Server-owned ride lifecycle and OTP',
    'Fuel cost-sharing ledger (legal-gated settlement)'
  ]
)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  tagline = EXCLUDED.tagline,
  route = EXCLUDED.route,
  icon_name = EXCLUDED.icon_name,
  is_active = true,
  society_configurable = true;

-- Do NOT auto-enable for every feature package. Pilot societies enable via Feature Management.

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  company_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_domains_domain_format CHECK (domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS company_domains_domain_unique
  ON public.company_domains (lower(domain));

CREATE TABLE IF NOT EXISTS public.commute_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'both' CHECK (role IN ('host', 'guest', 'both')),
  transport_preference text NOT NULL DEFAULT 'looking'
    CHECK (transport_preference IN ('car', 'bike', 'looking')),
  company_name text,
  is_paused boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_profiles_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_commute_profiles_society
  ON public.commute_profiles (society_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  email text NOT NULL,
  domain_id uuid REFERENCES public.company_domains(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'expired', 'revoked', 'rejected')),
  verified_at timestamptz,
  expires_at timestamptz,
  -- OTP secrets live only in edge/service flows; never expose via client SELECT policies.
  otp_hash text,
  otp_expires_at timestamptz,
  otp_attempt_count integer NOT NULL DEFAULT 0,
  last_otp_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_verifications_user_active_unique
  ON public.work_verifications (user_id)
  WHERE status = 'verified';

CREATE INDEX IF NOT EXISTS idx_work_verifications_email_lower
  ON public.work_verifications (lower(email));

CREATE TABLE IF NOT EXISTS public.office_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  label text,
  address_text text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location extensions.geography(Point, 4326),
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_office_locations_user
  ON public.office_locations (user_id);
CREATE INDEX IF NOT EXISTS idx_office_locations_geo
  ON public.office_locations USING gist (location);

CREATE TABLE IF NOT EXISTS public.commute_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_working boolean NOT NULL DEFAULT true,
  depart_time time,
  return_time time,
  pickup_label text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  pickup_location extensions.geography(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_templates_user_weekday UNIQUE (user_id, weekday)
);

CREATE TABLE IF NOT EXISTS public.commute_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  is_working boolean NOT NULL DEFAULT true,
  depart_time time,
  return_time time,
  pickup_label text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  pickup_location extensions.geography(Point, 4326),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_overrides_user_date UNIQUE (user_id, override_date)
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('car', 'bike')),
  make text,
  model text,
  color text,
  registration_number text,
  seat_capacity integer NOT NULL DEFAULT 1 CHECK (seat_capacity >= 1 AND seat_capacity <= 8),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_bike_seat_cap CHECK (
    vehicle_type <> 'bike' OR seat_capacity <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user_active
  ON public.vehicles (user_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.society_neighbours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  neighbour_society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_neighbours_not_self CHECK (society_id <> neighbour_society_id),
  CONSTRAINT society_neighbours_pair_unique UNIQUE (society_id, neighbour_society_id)
);

CREATE TABLE IF NOT EXISTS public.cleaner_city_settings (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  match_scope text NOT NULL DEFAULT 'neighbours'
    CHECK (match_scope IN ('same_society', 'neighbours', 'city')),
  thresholds jsonb NOT NULL DEFAULT jsonb_build_object(
    'pickup_deviation_km', 1.5,
    'destination_deviation_km', 2.0,
    'departure_difference_minutes', 30,
    'max_detour_minutes', 15,
    'min_seats', 1,
    'min_route_overlap_pct', 65
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commute_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  travel_date date NOT NULL,
  direction text NOT NULL DEFAULT 'to_office' CHECK (direction IN ('to_office', 'to_home')),
  depart_time time NOT NULL,
  seats_available integer NOT NULL DEFAULT 1 CHECK (seats_available >= 0),
  seats_total integer NOT NULL DEFAULT 1 CHECK (seats_total >= 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'full', 'cancelled', 'completed')),
  route_polyline text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commute_publications_society_date
  ON public.commute_publications (society_id, travel_date, status);

CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  publication_id uuid REFERENCES public.commute_publications(id) ON DELETE SET NULL,
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  travel_date date NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested', 'rejected', 'confirmed', 'pickup_pending', 'started',
      'completed', 'cancelled', 'no_show', 'disputed', 'safety_incident',
      'verification_failed'
    )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rides_host_date ON public.rides (host_user_id, travel_date);
CREATE INDEX IF NOT EXISTS idx_rides_guest_date ON public.rides (guest_user_id, travel_date);
CREATE INDEX IF NOT EXISTS idx_rides_society_status ON public.rides (society_id, status);

CREATE TABLE IF NOT EXISTS public.ride_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_events_ride_created
  ON public.ride_events (ride_id, created_at);

CREATE TABLE IF NOT EXISTS public.ride_cost_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  proposer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_paise integer NOT NULL CHECK (amount_paise >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'declined', 'settled', 'cancelled', 'disputed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_cost_shares_ride
  ON public.ride_cost_shares (ride_id, status);

-- Keep geography in sync when lat/lng provided
CREATE OR REPLACE FUNCTION public.cleaner_city_sync_point_geography()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::extensions.geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_office_locations_sync_geo ON public.office_locations;
CREATE TRIGGER trg_office_locations_sync_geo
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.office_locations
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_sync_point_geography();

CREATE OR REPLACE FUNCTION public.cleaner_city_sync_pickup_geography()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.pickup_latitude IS NOT NULL AND NEW.pickup_longitude IS NOT NULL THEN
    NEW.pickup_location := ST_SetSRID(
      ST_MakePoint(NEW.pickup_longitude, NEW.pickup_latitude),
      4326
    )::extensions.geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commute_templates_sync_geo ON public.commute_templates;
CREATE TRIGGER trg_commute_templates_sync_geo
  BEFORE INSERT OR UPDATE OF pickup_latitude, pickup_longitude ON public.commute_templates
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_sync_pickup_geography();

DROP TRIGGER IF EXISTS trg_commute_overrides_sync_geo ON public.commute_overrides;
CREATE TRIGGER trg_commute_overrides_sync_geo
  BEFORE INSERT OR UPDATE OF pickup_latitude, pickup_longitude ON public.commute_overrides
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_sync_pickup_geography();

-- ---------------------------------------------------------------------------
-- Match-scope helper (C-ready)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleaner_city_allowed_society_ids(p_uid uuid DEFAULT auth.uid())
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid;
  v_scope text;
  v_ids uuid[];
BEGIN
  IF p_uid IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_society := public.get_user_society_id(p_uid);
  IF v_society IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT s.match_scope INTO v_scope
  FROM public.cleaner_city_settings s
  WHERE s.society_id = v_society;

  v_scope := COALESCE(v_scope, 'neighbours');

  IF v_scope = 'same_society' THEN
    RETURN ARRAY[v_society];
  END IF;

  IF v_scope = 'city' THEN
    SELECT coalesce(array_agg(id), ARRAY[v_society])
    INTO v_ids
    FROM public.societies
    WHERE is_active = true;
    RETURN v_ids;
  END IF;

  -- neighbours (default): self + active neighbour edges (either direction)
  SELECT coalesce(
    array_agg(DISTINCT sid),
    ARRAY[v_society]
  )
  INTO v_ids
  FROM (
    SELECT v_society AS sid
    UNION
    SELECT n.neighbour_society_id
    FROM public.society_neighbours n
    WHERE n.society_id = v_society AND n.status = 'active'
    UNION
    SELECT n.society_id
    FROM public.society_neighbours n
    WHERE n.neighbour_society_id = v_society AND n.status = 'active'
  ) x;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_allowed_society_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_allowed_society_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleaner_city_allowed_society_ids(uuid) TO service_role;

COMMENT ON FUNCTION public.cleaner_city_allowed_society_ids(uuid) IS
  'A Cleaner City match scope expander. same_society | neighbours | city. Cross-society data leakage must still be prevented by table RLS and match RPCs.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_neighbours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_city_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_cost_shares ENABLE ROW LEVEL SECURITY;

-- company_domains: authenticated can read approved; admins manage all
DROP POLICY IF EXISTS company_domains_select ON public.company_domains;
CREATE POLICY company_domains_select ON public.company_domains
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR status = 'approved'
  );

DROP POLICY IF EXISTS company_domains_admin_write ON public.company_domains;
CREATE POLICY company_domains_admin_write ON public.company_domains
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- commute_profiles: own society only (discovery expansion happens via RPCs later)
DROP POLICY IF EXISTS commute_profiles_select ON public.commute_profiles;
CREATE POLICY commute_profiles_select ON public.commute_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR user_id = auth.uid()
    OR (
      deleted_at IS NULL
      AND society_id = public.get_user_society_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS commute_profiles_write ON public.commute_profiles;
CREATE POLICY commute_profiles_write ON public.commute_profiles
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_commute_profiles_write ON public.commute_profiles;
CREATE POLICY feature_gate_commute_profiles_write ON public.commute_profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- work_verifications: owner + admins; otp_hash readable only by owner/admin (still prefer edge)
DROP POLICY IF EXISTS work_verifications_select ON public.work_verifications;
CREATE POLICY work_verifications_select ON public.work_verifications
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS work_verifications_write ON public.work_verifications;
CREATE POLICY work_verifications_write ON public.work_verifications
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_work_verifications_write ON public.work_verifications;
CREATE POLICY feature_gate_work_verifications_write ON public.work_verifications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- office_locations: owner-only (stricter than profile) - Cross-society access denied
DROP POLICY IF EXISTS office_locations_select ON public.office_locations;
CREATE POLICY office_locations_select ON public.office_locations
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS office_locations_write ON public.office_locations;
CREATE POLICY office_locations_write ON public.office_locations
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_office_locations_write ON public.office_locations;
CREATE POLICY feature_gate_office_locations_write ON public.office_locations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- schedules: owner + society admin
DROP POLICY IF EXISTS commute_templates_select ON public.commute_templates;
CREATE POLICY commute_templates_select ON public.commute_templates
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS commute_templates_write ON public.commute_templates;
CREATE POLICY commute_templates_write ON public.commute_templates
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_commute_templates_write ON public.commute_templates;
CREATE POLICY feature_gate_commute_templates_write ON public.commute_templates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

DROP POLICY IF EXISTS commute_overrides_select ON public.commute_overrides;
CREATE POLICY commute_overrides_select ON public.commute_overrides
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS commute_overrides_write ON public.commute_overrides;
CREATE POLICY commute_overrides_write ON public.commute_overrides
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_commute_overrides_write ON public.commute_overrides;
CREATE POLICY feature_gate_commute_overrides_write ON public.commute_overrides
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- vehicles
DROP POLICY IF EXISTS vehicles_select ON public.vehicles;
CREATE POLICY vehicles_select ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR user_id = auth.uid()
    OR society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS vehicles_write ON public.vehicles;
CREATE POLICY vehicles_write ON public.vehicles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_vehicles_write ON public.vehicles;
CREATE POLICY feature_gate_vehicles_write ON public.vehicles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- society_neighbours: readable by members of either society; writable by platform/society admin
DROP POLICY IF EXISTS society_neighbours_select ON public.society_neighbours;
CREATE POLICY society_neighbours_select ON public.society_neighbours
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR society_id = public.get_user_society_id(auth.uid())
    OR neighbour_society_id = public.get_user_society_id(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

DROP POLICY IF EXISTS society_neighbours_admin_write ON public.society_neighbours;
CREATE POLICY society_neighbours_admin_write ON public.society_neighbours
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- settings
DROP POLICY IF EXISTS cleaner_city_settings_select ON public.cleaner_city_settings;
CREATE POLICY cleaner_city_settings_select ON public.cleaner_city_settings
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR society_id = public.get_user_society_id(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

DROP POLICY IF EXISTS cleaner_city_settings_admin_write ON public.cleaner_city_settings;
CREATE POLICY cleaner_city_settings_admin_write ON public.cleaner_city_settings
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- publications: society members can read published; host writes
DROP POLICY IF EXISTS commute_publications_select ON public.commute_publications;
CREATE POLICY commute_publications_select ON public.commute_publications
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR host_user_id = auth.uid()
    OR (
      status IN ('published', 'full')
      AND society_id = public.get_user_society_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS commute_publications_write ON public.commute_publications;
CREATE POLICY commute_publications_write ON public.commute_publications
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR host_user_id = auth.uid())
  WITH CHECK (
    host_user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_commute_publications_write ON public.commute_publications;
CREATE POLICY feature_gate_commute_publications_write ON public.commute_publications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- rides: participants + admins
DROP POLICY IF EXISTS rides_select ON public.rides;
CREATE POLICY rides_select ON public.rides
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR host_user_id = auth.uid()
    OR guest_user_id = auth.uid()
  );

DROP POLICY IF EXISTS rides_write ON public.rides;
CREATE POLICY rides_write ON public.rides
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR host_user_id = auth.uid()
    OR guest_user_id = auth.uid()
  )
  WITH CHECK (
    society_id = public.get_user_society_id(auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_rides_write ON public.rides;
CREATE POLICY feature_gate_rides_write ON public.rides
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );

-- ride_events: participants read; inserts via service/RPC preferred
DROP POLICY IF EXISTS ride_events_select ON public.ride_events;
CREATE POLICY ride_events_select ON public.ride_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND (r.host_user_id = auth.uid() OR r.guest_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS ride_events_insert ON public.ride_events;
CREATE POLICY ride_events_insert ON public.ride_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR actor_id = auth.uid()
  );

-- cost shares: participants
DROP POLICY IF EXISTS ride_cost_shares_select ON public.ride_cost_shares;
CREATE POLICY ride_cost_shares_select ON public.ride_cost_shares
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR proposer_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND (r.host_user_id = auth.uid() OR r.guest_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS ride_cost_shares_write ON public.ride_cost_shares;
CREATE POLICY ride_cost_shares_write ON public.ride_cost_shares
  FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR proposer_user_id = auth.uid()
  )
  WITH CHECK (
    proposer_user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS feature_gate_ride_cost_shares_write ON public.ride_cost_shares;
CREATE POLICY feature_gate_ride_cost_shares_write ON public.ride_cost_shares
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')
  );
