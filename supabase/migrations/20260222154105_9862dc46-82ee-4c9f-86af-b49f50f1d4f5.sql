
-- Drop existing trigger and recreate with enhanced validation
DROP TRIGGER IF EXISTS trg_validate_job_visibility_scope ON public.worker_job_requests;

CREATE OR REPLACE FUNCTION public.validate_job_visibility_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.visibility_scope NOT IN ('society', 'nearby') THEN
    RAISE EXCEPTION 'Invalid visibility_scope: %. Must be society or nearby', NEW.visibility_scope;
  END IF;
  IF NEW.visibility_scope = 'nearby' AND (NEW.target_society_ids IS NULL OR array_length(NEW.target_society_ids, 1) IS NULL OR array_length(NEW.target_society_ids, 1) = 0) THEN
    RAISE EXCEPTION 'At least one target society must be selected when visibility_scope is nearby';
  END IF;
  IF NEW.visibility_scope = 'society' THEN
    NEW.target_society_ids := '{}';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_job_visibility_scope
BEFORE INSERT OR UPDATE ON public.worker_job_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_job_visibility_scope();

-- Add radius config to system_settings (columns already added above via IF NOT EXISTS)
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('worker_broadcast_radius_options', '[3, 5, 10]', 'Available broadcast radius options in km for job posting'),
  ('worker_broadcast_default_radius', '5', 'Default broadcast radius in km'),
  ('default_worker_language', 'hi', 'Default language code for worker registration')
ON CONFLICT (key) DO NOTHING;
