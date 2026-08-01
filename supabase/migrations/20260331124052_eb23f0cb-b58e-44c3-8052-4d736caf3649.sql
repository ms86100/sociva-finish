ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS invalid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS invalid_count integer DEFAULT 0;