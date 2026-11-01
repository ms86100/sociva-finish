-- Local harness for B3. Not a production migration.
-- Minimal tables and stubs so cleaner_city_request_ride can run on plain Postgres.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.commute_publications (
  id uuid PRIMARY KEY,
  host_user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  travel_date date NOT NULL,
  direction text NOT NULL,
  status text NOT NULL,
  seats_available integer NOT NULL,
  seats_total integer NOT NULL,
  origin_latitude double precision,
  origin_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid,
  society_id uuid,
  host_user_id uuid,
  guest_user_id uuid,
  travel_date date,
  status text,
  guest_pickup_latitude double precision,
  guest_pickup_longitude double precision,
  guest_dest_latitude double precision,
  guest_dest_longitude double precision,
  estimated_fuel_paise integer,
  request_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.commute_blocks (
  blocker_user_id uuid,
  blocked_user_id uuid
);

CREATE OR REPLACE FUNCTION public.cleaner_city_require_verified_commuter(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_haversine_meters(
  a double precision, b double precision, c double precision, d double precision
) RETURNS double precision LANGUAGE sql AS $$ SELECT 1000::double precision $$;

CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_fuel_paise(
  p_meters double precision, p_seats integer
) RETURNS integer LANGUAGE sql AS $$ SELECT 100 $$;

CREATE OR REPLACE FUNCTION public.cleaner_city_append_ride_event(
  p_ride uuid, p_society uuid, p_actor uuid, p_type text, p_from text, p_to text, p_meta jsonb
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;

CREATE OR REPLACE FUNCTION public.cleaner_city_enqueue_notify(
  p_user uuid, p_title text, p_body text, p_type text, p_ref uuid, p_society uuid, p_key text
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;

CREATE OR REPLACE FUNCTION public.b3_delay_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('b3.delay', true), '') = '1' THEN
    PERFORM pg_sleep(2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS b3_delay_insert ON public.rides;
CREATE TRIGGER b3_delay_insert
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.b3_delay_insert();
