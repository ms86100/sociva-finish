-- 1. Reset all stuck 'processing' notifications to 'failed' so they stop looping
UPDATE public.notification_queue
SET status = 'failed',
    last_error = 'FIREBASE_SERVICE_ACCOUNT not configured — push provider unavailable. In-app delivery was not attempted for these legacy items.',
    processed_at = now()
WHERE status = 'processing';

-- 2. Add sla_deadline to disputes table for SLA cron job
ALTER TABLE public.disputes
ADD COLUMN IF NOT EXISTS sla_deadline timestamptz DEFAULT (now() + interval '48 hours');

-- 3. Grant service_role full access to delivery_assignments (fixes permission denied for monitor-stalled edge function)
GRANT ALL ON public.delivery_assignments TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.system_settings TO service_role;
GRANT ALL ON public.notification_queue TO service_role;
GRANT ALL ON public.seller_profiles TO service_role;