CREATE INDEX IF NOT EXISTS idx_user_notifications_society_id
ON user_notifications(society_id) WHERE society_id IS NOT NULL;