-- ============================================================
-- Phase 0 HARDENED — admin governance
-- society_id lock, audit_log RPC, cron is_admin, GMV RPC,
-- credentials meta-only residual note
-- ============================================================

-- ------------------------------------------------------------
-- 1) Lock profiles.society_id + verification_status against self-update
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role / SECURITY DEFINER owners may change
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('authenticated', 'anon') THEN
    -- Allow first-time society join: NULL → set (signup / join flow)
    IF NEW.society_id IS DISTINCT FROM OLD.society_id THEN
      IF OLD.society_id IS NOT NULL
         AND NOT public.is_admin(auth.uid())
         AND current_setting('app.allow_society_change', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'profiles.society_id is locked — use join/admin RPC'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       AND NOT public.is_admin(auth.uid())
       AND current_setting('app.allow_verification_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.verification_status cannot be self-updated'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged_columns
  BEFORE UPDATE OF society_id, verification_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();

COMMENT ON FUNCTION public.guard_profile_privileged_columns() IS
  'Fail-closed: society_id once set and verification_status are not self-updatable except admin or audited RPCs that set app.allow_*.';

-- ------------------------------------------------------------
-- 2) Revoke client audit_log INSERT; write_audit_event allowlist
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "Users can insert audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "Anyone can insert audit logs" ON public.audit_log;

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_society_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_action text := lower(trim(p_action));
  v_allowed text[] := ARRAY[
    'login','logout','profile_update','seller_apply','seller_approve','seller_reject',
    'order_cancel','order_advance','refund_request','refund_approve','refund_reject',
    'settlement_view','admin_action','credential_update','cron_enable','cron_disable',
    'cron_reschedule','society_join','society_leave','warning_issued','report_filed',
    'report_resolved','payment_confirm','moderation','feature_toggle','settings_update'
  ];
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_action IS NULL OR length(v_action) < 2 OR length(v_action) > 80 THEN
    RAISE EXCEPTION 'Invalid audit action';
  END IF;

  -- Allowlist OR admin/service may write any action
  IF NOT (
    v_action = ANY (v_allowed)
    OR public.is_admin(auth.uid())
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Audit action not allowed: %', v_action USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, society_id, metadata)
  VALUES (
    auth.uid(),
    v_action,
    left(COALESCE(p_target_type, 'unknown'), 80),
    left(COALESCE(p_target_id, ''), 120),
    p_society_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) IS
  'SECURITY DEFINER audited insert with action allowlist. Client direct INSERT on audit_log revoked.';

-- ------------------------------------------------------------
-- 3) get_cron_jobs / get_cron_job_runs gated with is_admin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cron_jobs()
RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT j.jobid, j.jobname::text, j.schedule::text, j.command::text, j.active
  FROM cron.job j
  ORDER BY j.jobid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cron_job_runs(p_jobid bigint, p_limit int DEFAULT 20)
RETURNS TABLE(runid bigint, job_id bigint, status text, return_message text, start_time timestamptz, end_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.runid, r.jobid, r.status::text, r.return_message::text, r.start_time, r.end_time
  FROM cron.job_run_details r
  WHERE (p_jobid = 0 OR r.jobid = p_jobid)
  ORDER BY r.start_time DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_jobs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cron_job_runs(bigint, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_jobs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_job_runs(bigint, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Admin settled GMV RPC (paid − refunded, exclude cancelled) — no 5k truncation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_settled_gmv(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_paid numeric := 0;
  v_refunded numeric := 0;
  v_orders bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(pr.amount) FILTER (WHERE pr.payment_status = 'paid'), 0),
    COALESCE(SUM(pr.amount) FILTER (WHERE pr.payment_status = 'refunded'), 0),
    COUNT(*) FILTER (WHERE pr.payment_status = 'paid')
  INTO v_paid, v_refunded, v_orders
  FROM public.payment_records pr
  JOIN public.orders o ON o.id = pr.order_id
  WHERE o.status::text NOT IN ('cancelled', 'rejected')
    AND (p_from IS NULL OR pr.created_at >= p_from)
    AND (p_to IS NULL OR pr.created_at < p_to);

  -- Also subtract completed refund_requests amounts for paid rows still marked paid
  SELECT v_refunded + COALESCE(SUM(rr.amount), 0)
  INTO v_refunded
  FROM public.refund_requests rr
  WHERE rr.refund_state = 'refund_completed'
    AND (p_from IS NULL OR rr.settled_at >= p_from)
    AND (p_to IS NULL OR rr.settled_at < p_to);

  RETURN jsonb_build_object(
    'gross_paid', v_paid,
    'refunded', v_refunded,
    'settled_gmv', GREATEST(v_paid - v_refunded, 0),
    'paid_order_count', v_orders,
    'from', p_from,
    'to', p_to
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_settled_gmv(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_settled_gmv(timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_settled_gmv(timestamptz, timestamptz) IS
  'Admin settled revenue = paid − refunded (excludes cancelled orders). Server-side aggregate — no PostgREST row cap.';

-- ------------------------------------------------------------
-- 5) Credentials: block authenticated SELECT of raw secret values
--    Edge/service_role still reads admin_settings; FE must use meta RPC.
--    Residual: Deno secrets preferred; DB fallback for edge only.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Only admins can manage settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Admins can select admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Admins can update admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Admins can insert admin settings" ON public.admin_settings;

-- Meta-only SELECT: admins can see rows but we strip value via RPC;
-- direct SELECT still returns value under RLS — so revoke SELECT for authenticated
-- and provide upsert RPC for writes.

CREATE POLICY "Admins can insert admin settings"
  ON public.admin_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update admin settings"
  ON public.admin_settings FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Intentionally NO SELECT policy for authenticated — use get_admin_credential_meta.
-- service_role bypasses RLS for edge secret reads (Deno env preferred).

CREATE OR REPLACE FUNCTION public.upsert_admin_credential(
  p_key text,
  p_value text,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR length(trim(p_key)) < 2 THEN
    RAISE EXCEPTION 'Invalid key';
  END IF;
  IF p_value IS NULL OR length(trim(p_value)) < 1 THEN
    RAISE EXCEPTION 'Invalid value';
  END IF;

  INSERT INTO public.admin_settings (key, value, description, is_active)
  VALUES (p_key, p_value, p_description, COALESCE(p_is_active, true))
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.admin_settings.description),
      is_active = EXCLUDED.is_active,
      updated_at = now();

  PERFORM public.write_audit_event(
    'credential_update',
    'admin_settings',
    p_key,
    NULL,
    jsonb_build_object('is_active', p_is_active, 'value_len', length(p_value))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_admin_credential(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_admin_credential(text, text, text, boolean) TO authenticated, service_role;

COMMENT ON TABLE public.admin_settings IS
  'Platform credentials. Authenticated SELECT revoked (Phase 0) — use get_admin_credential_meta / upsert_admin_credential. Edge: prefer Deno secrets, service_role DB fallback OK. Residual risk: vault full migration deferred.';
