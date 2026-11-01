-- Drops the objects added by 20261102250000.
-- Does not restore older function bodies. To return booking, matching, cancel,
-- dispute, and repeat behavior, reapply the function bodies from
-- 20261102240000 and 20261102233000. Do not run the Phase 1 rollback.

DROP TRIGGER IF EXISTS cleaner_city_badges_on_complete ON public.rides;
DROP TRIGGER IF EXISTS ride_chat_rate_limit ON public.ride_chat_messages;
DROP TRIGGER IF EXISTS circle_chat_rate_limit ON public.commute_circle_messages;
DROP TRIGGER IF EXISTS circle_message_society ON public.commute_circle_messages;

DROP FUNCTION IF EXISTS public.cleaner_city_badges_on_complete();
DROP FUNCTION IF EXISTS public.cleaner_city_circle_message_society();
DROP FUNCTION IF EXISTS public.cleaner_city_chat_rate_limit();
DROP FUNCTION IF EXISTS public.cleaner_city_fail_fuel_payment(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_confirm_fuel_payment(uuid, text, text);
DROP FUNCTION IF EXISTS public.cleaner_city_attach_fuel_order(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_start_fuel_payment(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_refresh_badges(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_admin_review_vehicle_document(uuid, text, text);
DROP FUNCTION IF EXISTS public.cleaner_city_admin_resolve_dispute(uuid, text, text);
DROP FUNCTION IF EXISTS public.cleaner_city_appeal_dispute(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_rank_meetup_points(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_offer_named_backup(uuid, date, text, uuid, double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.cleaner_city_clear_publication_stop(uuid, integer);
DROP FUNCTION IF EXISTS public.cleaner_city_set_publication_stop(uuid, integer, text, double precision, double precision);
DROP FUNCTION IF EXISTS public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean);

DROP TABLE IF EXISTS public.ride_fuel_payments;
DROP TABLE IF EXISTS public.ride_dispute_cases;
DROP TABLE IF EXISTS public.cleaner_city_badges;
DROP TABLE IF EXISTS public.commute_circle_messages;
DROP TABLE IF EXISTS public.ride_chat_messages;
DROP TABLE IF EXISTS public.commute_publication_stops;

DROP POLICY IF EXISTS vehicle_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS vehicle_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS vehicle_documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS vehicle_documents_storage_delete ON storage.objects;
