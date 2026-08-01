
-- Fix the WITH CHECK (true) on worker job update policy
DROP POLICY "Worker can update job" ON public.worker_job_requests;

CREATE POLICY "Worker can update job"
  ON public.worker_job_requests FOR UPDATE TO authenticated
  USING (
    accepted_by = auth.uid()
    OR (status = 'open' AND society_id IN (
      SELECT sw.society_id FROM public.society_workers sw WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
    ))
  )
  WITH CHECK (
    accepted_by = auth.uid()
    OR (society_id IN (
      SELECT sw.society_id FROM public.society_workers sw WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
    ))
  );
