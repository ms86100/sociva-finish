
-- =============================================
-- Step 1A: supported_languages table
-- =============================================
CREATE TABLE public.supported_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  native_name text NOT NULL,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.supported_languages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read languages"
  ON public.supported_languages FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Only admins can insert languages"
  ON public.supported_languages FOR INSERT
  TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Only admins can update languages"
  ON public.supported_languages FOR UPDATE
  TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Only admins can delete languages"
  ON public.supported_languages FOR DELETE
  TO authenticated USING (public.is_admin(auth.uid()));

-- Seed initial languages
INSERT INTO public.supported_languages (code, name, native_name, display_order) VALUES
  ('hi', 'Hindi', 'हिन्दी', 1),
  ('en', 'English', 'English', 2),
  ('ta', 'Tamil', 'தமிழ்', 3),
  ('te', 'Telugu', 'తెలుగు', 4),
  ('bn', 'Bengali', 'বাংলা', 5),
  ('mr', 'Marathi', 'मराठी', 6),
  ('kn', 'Kannada', 'ಕನ್ನಡ', 7),
  ('gu', 'Gujarati', 'ગુજરાતી', 8),
  ('ml', 'Malayalam', 'മലയാളം', 9),
  ('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 10);

-- =============================================
-- Step 1B: preferred_language on society_workers
-- =============================================
ALTER TABLE public.society_workers
  ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'hi';

-- =============================================
-- Step 1C: visibility_scope and target_society_ids on worker_job_requests
-- =============================================
ALTER TABLE public.worker_job_requests
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'society',
  ADD COLUMN IF NOT EXISTS target_society_ids uuid[] DEFAULT '{}';

-- Validation trigger for visibility_scope
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
  IF NEW.visibility_scope = 'nearby' AND (NEW.target_society_ids IS NULL OR array_length(NEW.target_society_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'target_society_ids must have at least one entry when visibility_scope is nearby';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_job_visibility_scope
  BEFORE INSERT OR UPDATE ON public.worker_job_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_job_visibility_scope();

-- =============================================
-- Step 1D: job_tts_cache table
-- =============================================
CREATE TABLE public.job_tts_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.worker_job_requests(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  summary_text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(job_id, language_code)
);

ALTER TABLE public.job_tts_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read TTS cache"
  ON public.job_tts_cache FOR SELECT
  TO authenticated USING (true);

-- =============================================
-- Step 2A: Cross-society job visibility RLS
-- =============================================
CREATE POLICY "Workers can see cross-society jobs"
  ON public.worker_job_requests FOR SELECT
  TO authenticated USING (
    resident_id = auth.uid()
    OR society_id = public.get_user_society_id(auth.uid())
    OR (visibility_scope = 'nearby' AND public.get_user_society_id(auth.uid()) = ANY(target_society_ids))
    OR public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- =============================================
-- Step 3: Update accept_worker_job RPC
-- =============================================
CREATE OR REPLACE FUNCTION public.accept_worker_job(_job_id uuid, _worker_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _job record;
  _worker record;
  _society_name text;
BEGIN
  SELECT * INTO _job FROM worker_job_requests WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job not found'); END IF;
  IF _job.status != 'open' THEN RETURN jsonb_build_object('success', false, 'error', 'Job already accepted or closed'); END IF;
  IF _job.accepted_by IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Job already accepted'); END IF;

  IF _job.visibility_scope = 'nearby' THEN
    SELECT * INTO _worker FROM society_workers
    WHERE user_id = _worker_id
      AND (society_id = _job.society_id OR society_id = ANY(_job.target_society_ids))
      AND deactivated_at IS NULL
    LIMIT 1;
  ELSE
    SELECT * INTO _worker FROM society_workers
    WHERE user_id = _worker_id
      AND society_id = _job.society_id
      AND deactivated_at IS NULL;
  END IF;

  IF _worker IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Worker not registered in eligible society'); END IF;

  UPDATE worker_job_requests SET status = 'accepted', accepted_by = _worker_id, accepted_at = now(), updated_at = now() WHERE id = _job_id;

  SELECT s.name INTO _society_name FROM societies s WHERE s.id = _worker.society_id;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _job.resident_id,
    '✅ Worker Accepted Your Job!',
    COALESCE(_worker.worker_type, 'Worker') || ' from ' || COALESCE(_society_name, 'your society') || ' accepted your ' || _job.job_type || ' request',
    'worker_job',
    '/worker-hire',
    jsonb_build_object(
      'job_id', _job_id,
      'worker_name', _worker.worker_type,
      'worker_photo_url', _worker.photo_url,
      'worker_phone', _worker.phone,
      'worker_society', _society_name,
      'worker_rating', _worker.rating,
      'worker_total_jobs', _worker.total_jobs
    )
  );

  INSERT INTO audit_log (actor_id, action, target_type, target_id, society_id, metadata)
  VALUES (_worker_id, 'job_accepted', 'worker_job_request', _job_id::text, _job.society_id,
    jsonb_build_object('job_type', _job.job_type, 'resident_id', _job.resident_id));

  RETURN jsonb_build_object('success', true, 'job_id', _job_id);
END;
$$;

-- =============================================
-- Step 4: Notification trigger for new job posts
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_workers_on_job_posted()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _society_name text;
  _target_societies uuid[];
BEGIN
  SELECT name INTO _society_name FROM societies WHERE id = NEW.society_id;

  IF NEW.visibility_scope = 'nearby' THEN
    _target_societies := array_append(NEW.target_society_ids, NEW.society_id);
  ELSE
    _target_societies := ARRAY[NEW.society_id];
  END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT
    sw.user_id,
    '🔔 New Job Available!',
    NEW.job_type || ' job in ' || COALESCE(_society_name, 'your area') ||
      CASE WHEN NEW.price IS NOT NULL THEN ' - ₹' || NEW.price::text ELSE '' END ||
      CASE WHEN NEW.urgency = 'urgent' THEN ' (URGENT)' ELSE '' END,
    'worker_job',
    '/worker/jobs',
    jsonb_build_object('job_id', NEW.id, 'job_type', NEW.job_type, 'urgency', NEW.urgency, 'price', NEW.price)
  FROM society_workers sw
  WHERE sw.society_id = ANY(_target_societies)
    AND sw.deactivated_at IS NULL
    AND sw.status = 'active'
    AND sw.user_id != NEW.resident_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_workers_on_job_posted
  AFTER INSERT ON public.worker_job_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_workers_on_job_posted();

-- =============================================
-- Step 5: get_nearby_societies RPC
-- =============================================
CREATE OR REPLACE FUNCTION public.get_nearby_societies(_society_id uuid, _radius_km numeric DEFAULT 5)
  RETURNS TABLE(id uuid, name text, distance_km numeric)
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT s.id, s.name,
    ROUND(public.haversine_km(origin.latitude, origin.longitude, s.latitude, s.longitude)::numeric, 1)
  FROM societies s, societies origin
  WHERE origin.id = _society_id
    AND s.id != _society_id
    AND s.is_active = true
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND origin.latitude IS NOT NULL AND origin.longitude IS NOT NULL
    AND public.haversine_km(origin.latitude, origin.longitude, s.latitude, s.longitude) <= _radius_km
  ORDER BY 3;
$$;
