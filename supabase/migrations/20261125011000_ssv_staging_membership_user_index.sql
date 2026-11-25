-- Cover fetchOwnMembership / auth overlay lookups by user without a seq scan.
-- Unique (user_id) WHERE status=active already exists; pending/history still needs user_id + time.

CREATE INDEX IF NOT EXISTS society_memberships_user_requested_idx
  ON public.society_memberships (user_id, requested_at DESC);
