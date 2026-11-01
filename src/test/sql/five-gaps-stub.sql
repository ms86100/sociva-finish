CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.societies (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  name text,
  phone text,
  society_id uuid,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.commute_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  society_id uuid,
  role text,
  deleted_at timestamptz,
  autopilot_enabled boolean,
  autopilot_confirm_mode text,
  is_paused boolean,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.commute_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  society_id uuid,
  contact_name text,
  phone text,
  notify_user_id uuid,
  is_primary boolean DEFAULT false,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.commute_circles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid,
  name text,
  is_active boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.commute_circle_members (
  circle_id uuid,
  user_id uuid,
  role text,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.commute_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid,
  society_id uuid,
  vehicle_id uuid,
  travel_date date,
  direction text,
  depart_time time,
  seats_available integer,
  seats_total integer,
  status text,
  origin_latitude double precision,
  origin_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision,
  origin_label text,
  destination_label text,
  route_polyline text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid,
  society_id uuid,
  host_user_id uuid,
  guest_user_id uuid,
  travel_date date,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  guest_pickup_latitude double precision,
  guest_pickup_longitude double precision,
  guest_dest_latitude double precision,
  guest_dest_longitude double precision,
  estimated_fuel_paise integer,
  request_expires_at timestamptz,
  pickup_deadline_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.commute_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  society_id uuid,
  travel_date date,
  direction text,
  depart_time time,
  pickup_latitude double precision,
  pickup_longitude double precision,
  dest_latitude double precision,
  dest_longitude double precision,
  status text,
  matched_publication_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.commute_blocks (
  blocker_user_id uuid,
  blocked_user_id uuid
);
CREATE TABLE IF NOT EXISTS public.commute_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  society_id uuid,
  override_date date,
  is_working boolean,
  note text,
  updated_at timestamptz,
  UNIQUE (user_id, override_date)
);
CREATE TABLE IF NOT EXISTS public.office_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  latitude double precision,
  longitude double precision,
  label text,
  is_primary boolean,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.work_verifications (
  user_id uuid,
  email text,
  status text,
  verified_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.society_meetup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid,
  label text,
  latitude double precision,
  longitude double precision,
  kind text,
  is_active boolean DEFAULT true,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.ride_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid,
  reporter_user_id uuid,
  incident_type text,
  society_id uuid
);
CREATE TABLE IF NOT EXISTS public.vehicles (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION public.cleaner_city_haversine_meters(a double precision, b double precision, c double precision, d double precision)
RETURNS double precision LANGUAGE sql AS $$ SELECT 0::double precision $$;
CREATE OR REPLACE FUNCTION public.is_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.get_user_society_id(u uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_allowed_society_ids(u uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[]::uuid[] $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_require_verified_commuter(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_enqueue_notify(a uuid, b text, c text, d text, e uuid, f uuid, g text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_append_ride_event(a uuid, b uuid, c uuid, d text, e text, f text, g jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_lock_guest_booking(a uuid, b date, c text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_detour_minutes(a double precision, b double precision, c double precision, d double precision, e double precision, f double precision, g double precision, h double precision, i integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_fuel_paise(a double precision, b integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_reputation(a uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_effective_schedule(a uuid, b date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.cleaner_city_release_publication_seat(a uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
