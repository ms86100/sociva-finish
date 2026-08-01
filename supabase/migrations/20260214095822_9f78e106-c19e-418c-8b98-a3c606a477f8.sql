
-- =============================================
-- WORKER ECOSYSTEM — COMPLETE SCHEMA
-- =============================================

-- 1. Insert worker_marketplace feature toggle
INSERT INTO public.platform_features (feature_key, feature_name, description, is_core, society_configurable)
VALUES ('worker_marketplace', 'Worker Marketplace', 'AI-assisted daily help marketplace for workers and residents', false, true)
ON CONFLICT (feature_key) DO NOTHING;

-- 2. Create society_workers table
CREATE TABLE public.society_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  worker_type text NOT NULL DEFAULT 'general',
  skills jsonb DEFAULT '[]'::jsonb,
  languages text[] DEFAULT '{}',
  is_verified boolean DEFAULT false,
  is_available boolean DEFAULT true,
  rating numeric(3,2) DEFAULT 0,
  total_jobs integer DEFAULT 0,
  total_ratings integer DEFAULT 0,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, society_id)
);

CREATE INDEX idx_society_workers_society_type ON public.society_workers (society_id, worker_type);
CREATE INDEX idx_society_workers_available ON public.society_workers (society_id, worker_type) WHERE is_available = true AND deactivated_at IS NULL;
CREATE INDEX idx_society_workers_user ON public.society_workers (user_id);

ALTER TABLE public.society_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workers can view own record"
  ON public.society_workers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Society admin manages workers"
  ON public.society_workers FOR ALL TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id))
  WITH CHECK (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Residents can view society workers"
  ON public.society_workers FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()) AND is_available = true AND deactivated_at IS NULL);

CREATE POLICY "Platform admin full access to workers"
  ON public.society_workers FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Worker can update own record"
  ON public.society_workers FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Create worker_job_requests table
CREATE TABLE public.worker_job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  description text,
  price numeric(10,2),
  duration_hours integer DEFAULT 1,
  start_time timestamptz,
  location_details text,
  urgency text DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  accepted_by uuid REFERENCES public.profiles(id),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '24 hours'),
  payment_status text DEFAULT 'pending',
  payment_amount numeric(10,2),
  resident_rating integer,
  worker_rating integer,
  resident_review text,
  worker_review text,
  voice_summary_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Validation trigger instead of CHECK for status
CREATE OR REPLACE FUNCTION public.validate_worker_job_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('open', 'accepted', 'completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Invalid job status: %', NEW.status;
  END IF;
  IF NEW.urgency NOT IN ('normal', 'urgent', 'flexible') THEN
    RAISE EXCEPTION 'Invalid urgency: %', NEW.urgency;
  END IF;
  IF NEW.resident_rating IS NOT NULL AND (NEW.resident_rating < 1 OR NEW.resident_rating > 5) THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  IF NEW.worker_rating IS NOT NULL AND (NEW.worker_rating < 1 OR NEW.worker_rating > 5) THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_worker_job_status
  BEFORE INSERT OR UPDATE ON public.worker_job_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_worker_job_status();

CREATE INDEX idx_worker_jobs_society_status ON public.worker_job_requests (society_id, status);
CREATE INDEX idx_worker_jobs_accepted_by ON public.worker_job_requests (accepted_by);
CREATE INDEX idx_worker_jobs_resident ON public.worker_job_requests (resident_id);
CREATE INDEX idx_worker_jobs_created ON public.worker_job_requests (created_at DESC);
CREATE INDEX idx_worker_jobs_open ON public.worker_job_requests (society_id, job_type, created_at DESC) WHERE status = 'open';

ALTER TABLE public.worker_job_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Resident can create job requests"
  ON public.worker_job_requests FOR INSERT TO authenticated
  WITH CHECK (resident_id = auth.uid() AND society_id = public.get_user_society_id(auth.uid()));

CREATE POLICY "Resident can view own job requests"
  ON public.worker_job_requests FOR SELECT TO authenticated
  USING (resident_id = auth.uid());

CREATE POLICY "Worker can view open jobs in society"
  ON public.worker_job_requests FOR SELECT TO authenticated
  USING (status = 'open' AND society_id IN (
    SELECT sw.society_id FROM public.society_workers sw WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
  ));

CREATE POLICY "Worker can view accepted jobs"
  ON public.worker_job_requests FOR SELECT TO authenticated
  USING (accepted_by = auth.uid());

CREATE POLICY "Resident can update own job"
  ON public.worker_job_requests FOR UPDATE TO authenticated
  USING (resident_id = auth.uid()) WITH CHECK (resident_id = auth.uid());

CREATE POLICY "Worker can update job"
  ON public.worker_job_requests FOR UPDATE TO authenticated
  USING (accepted_by = auth.uid() OR (status = 'open' AND society_id IN (
    SELECT sw.society_id FROM public.society_workers sw WHERE sw.user_id = auth.uid() AND sw.deactivated_at IS NULL
  ))) WITH CHECK (true);

CREATE POLICY "Society admin manages job requests"
  ON public.worker_job_requests FOR ALL TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id))
  WITH CHECK (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Platform admin full access to jobs"
  ON public.worker_job_requests FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 4. Race-safe job acceptance RPC
CREATE OR REPLACE FUNCTION public.accept_worker_job(_job_id uuid, _worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _job record;
  _worker record;
BEGIN
  SELECT * INTO _job FROM worker_job_requests WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job not found'); END IF;
  IF _job.status != 'open' THEN RETURN jsonb_build_object('success', false, 'error', 'Job already accepted or closed'); END IF;
  IF _job.accepted_by IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job already accepted'); END IF;

  SELECT * INTO _worker FROM society_workers WHERE user_id = _worker_id AND society_id = _job.society_id AND deactivated_at IS NULL;
  IF _worker IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Worker not registered in this society'); END IF;

  UPDATE worker_job_requests SET status = 'accepted', accepted_by = _worker_id, accepted_at = now(), updated_at = now() WHERE id = _job_id;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, society_id, metadata)
  VALUES (_worker_id, 'job_accepted', 'worker_job_request', _job_id::text, _job.society_id,
    jsonb_build_object('job_type', _job.job_type, 'resident_id', _job.resident_id));

  RETURN jsonb_build_object('success', true, 'job_id', _job_id);
END;
$$;

-- 5. Job completion RPC
CREATE OR REPLACE FUNCTION public.complete_worker_job(_job_id uuid, _worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _job record;
BEGIN
  SELECT * INTO _job FROM worker_job_requests WHERE id = _job_id AND accepted_by = _worker_id FOR UPDATE;
  IF _job IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job not found or not assigned to you'); END IF;
  IF _job.status != 'accepted' THEN RETURN jsonb_build_object('success', false, 'error', 'Job is not in accepted status'); END IF;

  UPDATE worker_job_requests SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = _job_id;
  UPDATE society_workers SET total_jobs = total_jobs + 1, updated_at = now() WHERE user_id = _worker_id AND society_id = _job.society_id;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, society_id, metadata)
  VALUES (_worker_id, 'job_completed', 'worker_job_request', _job_id::text, _job.society_id, jsonb_build_object('job_type', _job.job_type));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 6. Rate worker RPC
CREATE OR REPLACE FUNCTION public.rate_worker_job(_job_id uuid, _rating integer, _review text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _job record;
BEGIN
  IF _rating < 1 OR _rating > 5 THEN RETURN jsonb_build_object('success', false, 'error', 'Rating must be between 1 and 5'); END IF;

  SELECT * INTO _job FROM worker_job_requests WHERE id = _job_id AND resident_id = auth.uid() AND status = 'completed' FOR UPDATE;
  IF _job IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job not found or not completed'); END IF;
  IF _job.resident_rating IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Already rated'); END IF;

  UPDATE worker_job_requests SET resident_rating = _rating, resident_review = _review, updated_at = now() WHERE id = _job_id;

  UPDATE society_workers SET
    total_ratings = total_ratings + 1,
    rating = (SELECT ROUND(AVG(wjr.resident_rating)::numeric, 2) FROM worker_job_requests wjr WHERE wjr.accepted_by = _job.accepted_by AND wjr.resident_rating IS NOT NULL),
    updated_at = now()
  WHERE user_id = _job.accepted_by AND society_id = _job.society_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. Triggers
CREATE TRIGGER update_society_workers_updated_at BEFORE UPDATE ON public.society_workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_worker_jobs_updated_at BEFORE UPDATE ON public.worker_job_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 8. Realtime for job requests
ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_job_requests;
