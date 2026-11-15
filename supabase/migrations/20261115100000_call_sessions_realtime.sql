-- Caller UI depends on postgres_changes on call_sessions to leave "Calling..."
-- and join LiveKit after the callee accepts. Without publication, accept succeeds
-- but the caller never joins (no audio both ways).
-- REPLICA IDENTITY FULL is required for filters on caller_id / callee_id.

ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'call_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;
  END IF;
END $$;
