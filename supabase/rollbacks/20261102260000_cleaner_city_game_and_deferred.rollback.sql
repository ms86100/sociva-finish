-- Drops the game/deferred additions. Does not restore older function bodies.
-- Reapply 20261102250000 if you need the previous stop limit and badge set.
-- Do not run the Phase 1 rollback.

DROP TRIGGER IF EXISTS direct_chat_rate_limit ON public.commute_direct_messages;
DROP FUNCTION IF EXISTS public.cleaner_city_escalate_outbound_alert(uuid);
DROP FUNCTION IF EXISTS public.cleaner_city_note_fuel_transfer(uuid, text, text);
DROP FUNCTION IF EXISTS public.cleaner_city_mark_fuel_transferred(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_link_payout_account(text);
DROP FUNCTION IF EXISTS public.cleaner_city_chat_inbox();
DROP FUNCTION IF EXISTS public.cleaner_city_send_direct_message(uuid, text);
DROP FUNCTION IF EXISTS public.cleaner_city_can_direct_chat(uuid, uuid);
DROP TABLE IF EXISTS public.commute_direct_messages;
ALTER TABLE public.commute_profiles DROP COLUMN IF EXISTS razorpay_route_account_id;
