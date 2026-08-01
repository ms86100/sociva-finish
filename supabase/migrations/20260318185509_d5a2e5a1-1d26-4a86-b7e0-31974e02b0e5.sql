ALTER TABLE public.live_activity_tokens ADD COLUMN IF NOT EXISTS last_pushed_eta int;
ALTER TABLE public.live_activity_tokens ADD COLUMN IF NOT EXISTS last_pushed_distance int;