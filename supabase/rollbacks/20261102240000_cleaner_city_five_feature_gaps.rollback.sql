-- Drops the additive five-gap objects.
-- Does not restore publication or circle SELECT policies.
-- Does not restore the previous find, booking, waitlist, or timeout function bodies.
-- Those functions now reference commute_seat_offers. Dropping that table without
-- restoring the previous function text will break booking. Do not run this file
-- unless you immediately reapply:
--   cleaner_city_request_ride from 20261102233000 (keeps the guest booking lock)
--   cleaner_city_find_matches from 20261102211000
--   cleaner_city_notify_waitlist_for_publication and cleaner_city_process_timeouts from 20261102230000
-- Do not run the Phase 1 rollback. It restores weaker publication and circle reads.

DROP TRIGGER IF EXISTS cleaner_city_notify_circle_publication ON public.commute_publications;
DROP TRIGGER IF EXISTS cleaner_city_queue_sos_sms ON public.ride_incidents;
DROP TRIGGER IF EXISTS cleaner_city_sync_contact_verification ON public.commute_emergency_contacts;

DROP FUNCTION IF EXISTS public.cleaner_city_notify_circle_about_publication();
DROP FUNCTION IF EXISTS public.cleaner_city_queue_sos_sms();
DROP FUNCTION IF EXISTS public.cleaner_city_sync_contact_verification();
DROP FUNCTION IF EXISTS public.cleaner_city_repeat_last_commute();
DROP FUNCTION IF EXISTS public.cleaner_city_mark_wfh(date);
DROP FUNCTION IF EXISTS public.cleaner_city_refresh_open_drafts();
DROP FUNCTION IF EXISTS public.cleaner_city_dispute_ride(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_set_circle_prefs(boolean, text, boolean);
DROP FUNCTION IF EXISTS public.cleaner_city_invite_to_circle(uuid, uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_respond_circle_invite(uuid, boolean);
DROP FUNCTION IF EXISTS public.cleaner_city_my_circle_invites();
DROP FUNCTION IF EXISTS public.cleaner_city_circle_tomorrow_board(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_admin_upsert_meetup_point(uuid, text, double precision, double precision, text, uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_start_contact_verification(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_confirm_contact_verification(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_request_masked_call(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_outbound_alert_status(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_polyline_overlap_pct(text, double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.cleaner_city_shl(bigint, integer);
