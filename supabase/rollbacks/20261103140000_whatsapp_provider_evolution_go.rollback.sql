-- Reversible rollback for WhatsApp Evolution Go provider tables/RPCs.
-- Does not delete historical whatsapp_messages rows.
-- After rollback, Meta-only path continues via existing whatsapp.ts.

DROP FUNCTION IF EXISTS public.admin_whatsapp_delivery_stats(timestamptz, text);
DROP FUNCTION IF EXISTS public.admin_audit_whatsapp_cross_provider_retry(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.admin_approve_whatsapp_evolution_live(text);
DROP FUNCTION IF EXISTS public.admin_update_whatsapp_evolution_readiness(boolean, boolean, boolean, boolean, boolean, jsonb);
DROP FUNCTION IF EXISTS public.admin_rollback_whatsapp_provider_to_meta(text);
DROP FUNCTION IF EXISTS public.admin_set_whatsapp_provider(text, text, text);
DROP FUNCTION IF EXISTS public.get_whatsapp_provider_config();
DROP FUNCTION IF EXISTS public.whatsapp_evolution_readiness_complete(public.whatsapp_provider_config);

DROP TABLE IF EXISTS public.communication_webhook_events;
DROP TABLE IF EXISTS public.communication_instances;
DROP TABLE IF EXISTS public.whatsapp_provider_audit;
DROP TABLE IF EXISTS public.whatsapp_provider_config;

-- Keep additive columns on whatsapp_messages (safe). Optional strip:
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS delivery_status_supported;
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS dry_run;
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS notification_queue_id;
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS provider_message_id;
-- ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS provider;
