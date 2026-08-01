-- Add apns_token column to device_tokens for direct APNs delivery on iOS
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS apns_token text;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_device_tokens_apns_token ON public.device_tokens (apns_token) WHERE apns_token IS NOT NULL;