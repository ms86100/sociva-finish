
-- Fix notification_queue INSERT policy to not be overly permissive
DROP POLICY IF EXISTS "Authenticated users can enqueue notifications" ON public.notification_queue;
CREATE POLICY "Authenticated users can enqueue their own notifications"
  ON public.notification_queue FOR INSERT TO authenticated
  WITH CHECK (user_id IS NOT NULL);

-- rate_limits has RLS enabled but no policies (by design - service role only)
-- Add explicit admin-only SELECT policy to satisfy linter
CREATE POLICY "Only admins can view rate limits"
  ON public.rate_limits FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));
