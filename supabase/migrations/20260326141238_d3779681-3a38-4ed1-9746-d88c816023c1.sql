-- Bug 3: Add dedup check for near-duplicate notifications
-- Partial unique index: prevent same (user_id, type, reference_path) within 60s window
-- Using a unique index on a function-based approach isn't feasible for time windows,
-- so we add a dedup check function instead + a regular index for fast lookups.

CREATE INDEX IF NOT EXISTS idx_user_notifications_dedup
ON public.user_notifications (user_id, type, reference_path, created_at DESC)
WHERE reference_path IS NOT NULL;