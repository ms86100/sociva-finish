
-- ============================================================
-- SOCIETY WORKFORCE MANAGEMENT SYSTEM
-- ============================================================

-- 1. Dynamic Worker Categories per Society
CREATE TABLE public.society_worker_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text DEFAULT '👤',
  requires_background_check boolean DEFAULT false,
  requires_security_training boolean DEFAULT false,
  entry_type text NOT NULL DEFAULT 'daily',
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, name)
);

CREATE OR REPLACE FUNCTION public.validate_worker_category_entry_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.entry_type NOT IN ('daily', 'shift', 'per_visit') THEN
    RAISE EXCEPTION 'Invalid entry_type: %. Must be daily, shift, or per_visit', NEW.entry_type;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_worker_category
  BEFORE INSERT OR UPDATE ON public.society_worker_categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_worker_category_entry_type();

CREATE TRIGGER trg_update_worker_categories_updated_at
  BEFORE UPDATE ON public.society_worker_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.society_worker_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view categories"
  ON public.society_worker_categories FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Society admins can manage categories"
  ON public.society_worker_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Society admins can update categories"
  ON public.society_worker_categories FOR UPDATE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Society admins can delete categories"
  ON public.society_worker_categories FOR DELETE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

CREATE INDEX idx_worker_categories_society ON public.society_worker_categories(society_id);

-- 2. Evolve society_workers with new columns
ALTER TABLE public.society_workers
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS allowed_shift_start time,
  ADD COLUMN IF NOT EXISTS allowed_shift_end time,
  ADD COLUMN IF NOT EXISTS active_days text[] DEFAULT '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}',
  ADD COLUMN IF NOT EXISTS entry_frequency text DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.society_worker_categories(id),
  ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.validate_worker_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'suspended', 'blacklisted', 'under_review') THEN
    RAISE EXCEPTION 'Invalid worker status: %. Must be active, suspended, blacklisted, or under_review', NEW.status;
  END IF;
  IF NEW.entry_frequency IS NOT NULL AND NEW.entry_frequency NOT IN ('daily', 'occasional', 'per_visit') THEN
    RAISE EXCEPTION 'Invalid entry_frequency: %', NEW.entry_frequency;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any to avoid conflict
DROP TRIGGER IF EXISTS trg_validate_worker_status ON public.society_workers;
CREATE TRIGGER trg_validate_worker_status
  BEFORE INSERT OR UPDATE ON public.society_workers
  FOR EACH ROW EXECUTE FUNCTION public.validate_worker_status();

CREATE INDEX IF NOT EXISTS idx_workers_society_status ON public.society_workers(society_id, status);
CREATE INDEX IF NOT EXISTS idx_workers_category ON public.society_workers(category_id) WHERE category_id IS NOT NULL;

-- 3. Worker Flat Assignments (many-to-many)
CREATE TABLE public.worker_flat_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES public.society_workers(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_number text NOT NULL,
  resident_id uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(worker_id, flat_number, society_id)
);

ALTER TABLE public.worker_flat_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view flat assignments"
  ON public.worker_flat_assignments FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Admins and residents can insert flat assignments"
  ON public.worker_flat_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin(auth.uid(), society_id) OR resident_id = auth.uid());

CREATE POLICY "Admins and residents can update flat assignments"
  ON public.worker_flat_assignments FOR UPDATE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id) OR resident_id = auth.uid());

CREATE POLICY "Admins and residents can delete flat assignments"
  ON public.worker_flat_assignments FOR DELETE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id) OR resident_id = auth.uid());

CREATE INDEX idx_flat_assignments_worker ON public.worker_flat_assignments(worker_id);
CREATE INDEX idx_flat_assignments_society ON public.worker_flat_assignments(society_id);
CREATE INDEX idx_flat_assignments_resident ON public.worker_flat_assignments(resident_id) WHERE resident_id IS NOT NULL;

-- 4. Worker Entry Logs (integrated with gate system)
CREATE TABLE public.worker_entry_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES public.society_workers(id),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  gate_entry_id uuid REFERENCES public.gate_entries(id),
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  validation_result text NOT NULL DEFAULT 'allowed',
  denial_reason text,
  verified_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_entry_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view entry logs"
  ON public.worker_entry_logs FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Security officers can insert entry logs"
  ON public.worker_entry_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_security_officer(auth.uid(), society_id) OR public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Security officers can update entry logs"
  ON public.worker_entry_logs FOR UPDATE TO authenticated
  USING (public.is_security_officer(auth.uid(), society_id) OR public.is_society_admin(auth.uid(), society_id));

CREATE INDEX idx_worker_entry_logs_society_date ON public.worker_entry_logs(society_id, entry_time DESC);
CREATE INDEX idx_worker_entry_logs_worker ON public.worker_entry_logs(worker_id, entry_time DESC);

-- 5. Worker Ratings (monthly rating for ongoing domestic work)
CREATE TABLE public.worker_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES public.society_workers(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  rated_by uuid NOT NULL REFERENCES public.profiles(id),
  rating integer NOT NULL,
  review text,
  month text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(worker_id, rated_by, month)
);

ALTER TABLE public.worker_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view ratings"
  ON public.worker_ratings FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Residents can rate workers"
  ON public.worker_ratings FOR INSERT TO authenticated
  WITH CHECK (rated_by = auth.uid() AND society_id = public.get_user_society_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.validate_worker_rating_value()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_worker_rating
  BEFORE INSERT OR UPDATE ON public.worker_ratings
  FOR EACH ROW EXECUTE FUNCTION public.validate_worker_rating_value();

CREATE OR REPLACE FUNCTION public.update_worker_avg_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.society_workers SET
    rating = (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM public.worker_ratings r WHERE r.worker_id = NEW.worker_id),
    total_ratings = (SELECT COUNT(*) FROM public.worker_ratings r WHERE r.worker_id = NEW.worker_id),
    updated_at = now()
  WHERE id = NEW.worker_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_update_worker_avg_rating
  AFTER INSERT ON public.worker_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_worker_avg_rating();

CREATE INDEX idx_worker_ratings_worker ON public.worker_ratings(worker_id);
CREATE INDEX idx_worker_ratings_society ON public.worker_ratings(society_id);

-- 6. Worker Validation RPC (gate integration)
CREATE OR REPLACE FUNCTION public.validate_worker_entry(_worker_id uuid, _society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _worker record;
  _category record;
  _current_time time;
  _current_day text;
  _flat_count integer;
  _flats jsonb;
BEGIN
  SELECT * INTO _worker FROM public.society_workers
  WHERE id = _worker_id AND society_id = _society_id;

  IF _worker IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Worker not found in this society');
  END IF;

  IF _worker.status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Worker status: ' || _worker.status,
      'status', _worker.status, 'suspension_reason', _worker.suspension_reason);
  END IF;

  IF _worker.deactivated_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Worker has been deactivated');
  END IF;

  _current_day := to_char(now(), 'Dy');
  IF _worker.active_days IS NOT NULL AND NOT (_current_day = ANY(_worker.active_days)) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Not scheduled for today (' || _current_day || ')');
  END IF;

  _current_time := now()::time;
  IF _worker.allowed_shift_start IS NOT NULL AND _worker.allowed_shift_end IS NOT NULL THEN
    IF _current_time < _worker.allowed_shift_start OR _current_time > _worker.allowed_shift_end THEN
      RETURN jsonb_build_object('valid', false, 'reason',
        'Outside shift hours (' || _worker.allowed_shift_start::text || ' - ' || _worker.allowed_shift_end::text || ')');
    END IF;
  END IF;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object('flat', wfa.flat_number)), '[]'::jsonb)
  INTO _flat_count, _flats
  FROM public.worker_flat_assignments wfa
  WHERE wfa.worker_id = _worker_id AND wfa.society_id = _society_id AND wfa.is_active = true;

  IF _flat_count = 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'No active flat assignments');
  END IF;

  IF _worker.category_id IS NOT NULL THEN
    SELECT * INTO _category FROM public.society_worker_categories WHERE id = _worker.category_id;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'worker_name', _worker.worker_type,
    'worker_type', _worker.worker_type,
    'photo_url', _worker.photo_url,
    'rating', _worker.rating,
    'total_jobs', _worker.total_jobs,
    'flat_count', _flat_count,
    'flats', _flats,
    'entry_type', COALESCE(_category.entry_type, _worker.entry_frequency),
    'requires_approval', COALESCE(_category.entry_type, _worker.entry_frequency) = 'per_visit'
  );
END;
$$;

-- 7. Add workforce_management feature toggle
INSERT INTO public.platform_features (feature_key, feature_name, description, is_core, society_configurable)
VALUES ('workforce_management', 'Workforce Management', 'Society workforce registry with shift validation, flat assignments, and gate integration', false, true)
ON CONFLICT (feature_key) DO NOTHING;
