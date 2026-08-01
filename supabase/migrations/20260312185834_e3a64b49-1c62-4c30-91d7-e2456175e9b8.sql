-- Function to list all cron jobs
CREATE OR REPLACE FUNCTION public.get_cron_jobs()
RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jobid, jobname::text, schedule::text, command::text, active
  FROM cron.job
  ORDER BY jobid;
$$;

-- Function to enable a cron job
CREATE OR REPLACE FUNCTION public.enable_cron_job(p_jobid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE cron.job SET active = true WHERE jobid = p_jobid;
END;
$$;

-- Function to disable a cron job
CREATE OR REPLACE FUNCTION public.disable_cron_job(p_jobid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE cron.job SET active = false WHERE jobid = p_jobid;
END;
$$;

-- Function to update cron schedule
CREATE OR REPLACE FUNCTION public.update_cron_schedule(p_jobid bigint, p_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE cron.job SET schedule = p_schedule WHERE jobid = p_jobid;
END;
$$;

-- Function to get recent cron job runs
CREATE OR REPLACE FUNCTION public.get_cron_job_runs(p_jobid bigint, p_limit int DEFAULT 20)
RETURNS TABLE(runid bigint, job_id bigint, status text, return_message text, start_time timestamptz, end_time timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT runid, jobid, status::text, return_message::text, start_time, end_time
  FROM cron.job_run_details
  WHERE (p_jobid = 0 OR jobid = p_jobid)
  ORDER BY start_time DESC
  LIMIT p_limit;
$$;