
-- Add explicit "deny all client access" policies to internal-only tables.
-- These tables are only written to / read by edge functions running with the
-- service-role key, which bypasses RLS. Adding USING(false) policies satisfies
-- the linter (RLS Enabled No Policy) without affecting any working code path.

-- audit_log_archive: archive of audit_log, only touched by archive-old-data /
-- purge-non-admin-data edge functions (service role).
DROP POLICY IF EXISTS "Block direct client access" ON public.audit_log_archive;
CREATE POLICY "Block direct client access"
  ON public.audit_log_archive
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- job_tts_cache: TTS audio cache, only touched by generate-job-voice-summary
-- edge function (service role).
DROP POLICY IF EXISTS "Block direct client access" ON public.job_tts_cache;
CREATE POLICY "Block direct client access"
  ON public.job_tts_cache
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- rate_limits: server-side rate-limit counters, only touched by edge functions
-- via _shared/rate-limiter.ts (service role).
DROP POLICY IF EXISTS "Block direct client access" ON public.rate_limits;
CREATE POLICY "Block direct client access"
  ON public.rate_limits
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
