-- Phase 1.2a: Fix auto_dismiss_delivery_notifications missing search_path
-- Drop trigger first, then function, then recreate both
DROP TRIGGER IF EXISTS trg_auto_dismiss_delivery_notifications ON public.orders;
DROP FUNCTION IF EXISTS public.auto_dismiss_delivery_notifications();

CREATE FUNCTION public.auto_dismiss_delivery_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_notifications
  SET is_read = true
  WHERE is_read = false
    AND type IN ('delivery_location_update', 'delivery_at_gate')
    AND created_at < now() - interval '2 hours';
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER trg_auto_dismiss_delivery_notifications
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.status IN ('delivered', 'completed', 'cancelled'))
  EXECUTE FUNCTION public.auto_dismiss_delivery_notifications();

-- Phase 1.2b: Fix permissive RLS policies

DROP POLICY IF EXISTS "Service role inserts escalations" ON public.collective_escalations;
CREATE POLICY "Authenticated users can insert escalations"
ON public.collective_escalations FOR INSERT TO authenticated
WITH CHECK (
  society_id IN (
    SELECT society_id FROM public.profiles WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated users can enqueue notifications" ON public.notification_queue;
CREATE POLICY "Authenticated users can enqueue notifications"
ON public.notification_queue FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role inserts reports" ON public.society_reports;
CREATE POLICY "Authenticated users can insert reports"
ON public.society_reports FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow insert for all" ON public.test_results;
CREATE POLICY "Authenticated users can insert test results"
ON public.test_results FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "System can insert trigger errors" ON public.trigger_errors;
CREATE POLICY "System inserts trigger errors"
ON public.trigger_errors FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "System can insert notifications" ON public.user_notifications;
CREATE POLICY "Authenticated users can insert notifications"
ON public.user_notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Worker can update job" ON public.worker_job_requests;
CREATE POLICY "Worker can update job"
ON public.worker_job_requests FOR UPDATE TO authenticated
USING (
  (accepted_by = auth.uid()) OR 
  (status = 'open' AND society_id IN (
    SELECT sw.society_id FROM public.society_workers sw 
    WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
  ))
)
WITH CHECK (
  (accepted_by = auth.uid()) OR 
  (status = 'open' AND society_id IN (
    SELECT sw.society_id FROM public.society_workers sw 
    WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
  ))
);

-- Phase 1.2c: Add policies for phone_otp_verifications
CREATE POLICY "Users can view own OTP verifications"
ON public.phone_otp_verifications FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own OTP verifications"
ON public.phone_otp_verifications FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own OTP verifications"
ON public.phone_otp_verifications FOR UPDATE TO authenticated
USING (user_id = auth.uid());