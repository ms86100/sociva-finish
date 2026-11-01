-- Rollback for 20261102090000_cleaner_city_foundation.sql
-- Prefer disabling the cleaner_city feature flag before dropping tables in production.

DROP TRIGGER IF EXISTS trg_commute_overrides_sync_geo ON public.commute_overrides;
DROP TRIGGER IF EXISTS trg_commute_templates_sync_geo ON public.commute_templates;
DROP TRIGGER IF EXISTS trg_office_locations_sync_geo ON public.office_locations;

DROP FUNCTION IF EXISTS public.cleaner_city_allowed_society_ids(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_sync_pickup_geography();
DROP FUNCTION IF EXISTS public.cleaner_city_sync_point_geography();

DROP TABLE IF EXISTS public.ride_cost_shares CASCADE;
DROP TABLE IF EXISTS public.ride_events CASCADE;
DROP TABLE IF EXISTS public.rides CASCADE;
DROP TABLE IF EXISTS public.commute_publications CASCADE;
DROP TABLE IF EXISTS public.cleaner_city_settings CASCADE;
DROP TABLE IF EXISTS public.society_neighbours CASCADE;
DROP TABLE IF EXISTS public.vehicles CASCADE;
DROP TABLE IF EXISTS public.commute_overrides CASCADE;
DROP TABLE IF EXISTS public.commute_templates CASCADE;
DROP TABLE IF EXISTS public.office_locations CASCADE;
DROP TABLE IF EXISTS public.work_verifications CASCADE;
DROP TABLE IF EXISTS public.commute_profiles CASCADE;
DROP TABLE IF EXISTS public.company_domains CASCADE;

DELETE FROM public.feature_package_items
WHERE feature_id IN (SELECT id FROM public.platform_features WHERE feature_key = 'cleaner_city');

DELETE FROM public.platform_features WHERE feature_key = 'cleaner_city';

-- PostGIS may be shared; do not drop the extension here.
