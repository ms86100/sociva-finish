DROP FUNCTION IF EXISTS public.admin_request_whatsapp_only_retry(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.complete_whatsapp_channel_delivery(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.claim_whatsapp_channel_delivery(uuid, boolean);

DROP INDEX IF EXISTS public.whatsapp_messages_success_once_per_queue;

ALTER TABLE public.communication_instances DROP COLUMN IF EXISTS webhook_trusted;

ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_updated_at;
ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_attempt_count;
ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_error;
ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_provider_message_id;
ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_provider;
ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS whatsapp_status;
