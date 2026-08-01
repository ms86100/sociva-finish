
-- Part 1, steps 1-3: prepare extensions schema and move pg_trgm out of public.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Add 'extensions' to search_path for every role that runs queries / cron jobs.
ALTER ROLE postgres      SET search_path = "$user", public, extensions;
ALTER ROLE authenticator SET search_path = "$user", public, extensions;
ALTER ROLE anon          SET search_path = "$user", public, extensions;
ALTER ROLE authenticated SET search_path = "$user", public, extensions;
ALTER ROLE service_role  SET search_path = "$user", public, extensions;

-- Move pg_trgm (lower blast radius). Existing GIN indexes keep working
-- because operator classes are resolved by OID inside the index.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
