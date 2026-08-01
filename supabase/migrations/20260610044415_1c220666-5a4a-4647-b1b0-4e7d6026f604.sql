
-- 1. Extend category_requests
ALTER TABLE public.category_requests
  ADD COLUMN IF NOT EXISTS parent_group_slug text,
  ADD COLUMN IF NOT EXISTS parent_category_slug text,
  ADD COLUMN IF NOT EXISTS merge_target_category text,
  ADD COLUMN IF NOT EXISTS created_category text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS suggested_alternatives text[],
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS normalized_name text GENERATED ALWAYS AS (lower(btrim(requested_name))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS category_requests_pending_unique
  ON public.category_requests (requested_by, normalized_name)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS category_requests_status_created_idx
  ON public.category_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS category_requests_normalized_idx
  ON public.category_requests (normalized_name);

-- 2. Admin RLS policies (additive)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='category_requests' AND policyname='Admins read all requests') THEN
    CREATE POLICY "Admins read all requests"
      ON public.category_requests FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='category_requests' AND policyname='Admins update requests') THEN
    CREATE POLICY "Admins update requests"
      ON public.category_requests FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 3. Anti-spam: rate-limit pending and 24h requests per seller
CREATE OR REPLACE FUNCTION public.enforce_category_request_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_count int;
  recent_count int;
BEGIN
  SELECT count(*) INTO pending_count
    FROM public.category_requests
    WHERE requested_by = NEW.requested_by AND status = 'pending';
  IF pending_count >= 5 THEN
    RAISE EXCEPTION 'category_request_limit_pending'
      USING HINT = 'You have too many pending category requests. Please wait for admin review.';
  END IF;

  SELECT count(*) INTO recent_count
    FROM public.category_requests
    WHERE requested_by = NEW.requested_by
      AND created_at > now() - interval '24 hours';
  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'category_request_limit_daily'
      USING HINT = 'Daily request limit reached. Try again tomorrow.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_requests_limit ON public.category_requests;
CREATE TRIGGER trg_category_requests_limit
  BEFORE INSERT ON public.category_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_category_request_limits();

-- 4. Audit trail
CREATE TABLE IF NOT EXISTS public.category_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.category_requests(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.category_request_audit TO authenticated;
GRANT ALL ON public.category_request_audit TO service_role;

ALTER TABLE public.category_request_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='category_request_audit' AND policyname='Admins read request audit') THEN
    CREATE POLICY "Admins read request audit"
      ON public.category_request_audit FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS category_request_audit_request_idx
  ON public.category_request_audit (request_id, created_at DESC);

-- 5. Auto-audit on insert and status change
CREATE OR REPLACE FUNCTION public.log_category_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.category_request_audit(request_id, actor_id, action, notes)
    VALUES (NEW.id, NEW.requested_by, 'submitted',
            jsonb_build_object('requested_name', NEW.requested_name,
                               'parent_group_hint', NEW.parent_group_hint));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.category_request_audit(request_id, actor_id, action, notes)
    VALUES (NEW.id, NEW.reviewed_by, NEW.status,
            jsonb_build_object(
              'merge_target_category', NEW.merge_target_category,
              'created_category', NEW.created_category,
              'rejection_reason', NEW.rejection_reason,
              'suggested_alternatives', NEW.suggested_alternatives
            ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_request_audit_ins ON public.category_requests;
CREATE TRIGGER trg_category_request_audit_ins
  AFTER INSERT ON public.category_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_category_request_change();

DROP TRIGGER IF EXISTS trg_category_request_audit_upd ON public.category_requests;
CREATE TRIGGER trg_category_request_audit_upd
  AFTER UPDATE ON public.category_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_category_request_change();
