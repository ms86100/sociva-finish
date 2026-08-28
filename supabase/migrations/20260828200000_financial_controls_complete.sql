-- Financial controls completion: adjustments workflow, admin notifications, richer snapshot

ALTER TABLE public.financial_adjustment_requests
  DROP CONSTRAINT IF EXISTS financial_adjustment_requests_status_check;
ALTER TABLE public.financial_adjustment_requests
  ADD CONSTRAINT financial_adjustment_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'posted'));

CREATE OR REPLACE FUNCTION public.notify_platform_admins_financial_review(
  p_exclude_user_id uuid,
  p_title text,
  p_body text,
  p_kind text DEFAULT 'financial_review'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT
    ur.user_id,
    p_title,
    p_body,
    'moderation',
    '/admin/financial-controls',
    jsonb_build_object('type', p_kind, 'target_role', 'admin')
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM p_exclude_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_platform_admins_financial_review(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_financial_review(uuid, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_ledger_account_codes()
RETURNS TABLE(code text, name text, account_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  RETURN QUERY
  SELECT a.code, a.name, a.account_type::text
  FROM finance.ledger_accounts a
  WHERE a.active
  ORDER BY a.code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_ledger_account_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_ledger_account_codes() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_financial_control_change(
  p_control_type text,
  p_control_key text,
  p_new_value text,
  p_reason text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_old_value text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_control_type = 'feature_flag' THEN
    SELECT enabled::text INTO v_old_value
    FROM public.financial_feature_flags
    WHERE key = p_control_key;
  ELSIF p_control_type = 'configuration' THEN
    SELECT value INTO v_old_value
    FROM public.financial_configuration
    WHERE key = p_control_key;
  ELSE
    RAISE EXCEPTION 'unsupported control type';
  END IF;
  IF v_old_value IS NULL THEN
    RAISE EXCEPTION 'unknown financial control';
  END IF;

  INSERT INTO public.financial_control_change_requests (
    control_type, control_key, old_value, new_value, reason,
    requested_by, expires_at
  ) VALUES (
    p_control_type, p_control_key, v_old_value, p_new_value, p_reason,
    auth.uid(), p_expires_at
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_control_change_requested',
    'financial_control_change_request', v_id,
    jsonb_build_object(
      'control_type', p_control_type,
      'control_key', p_control_key,
      'old_value', v_old_value,
      'new_value', p_new_value,
      'reason', p_reason
    )
  );

  PERFORM public.notify_platform_admins_financial_review(
    auth.uid(),
    'Financial control awaiting approval',
    format(
      '%s → %s for %s (%s). Open Financial controls to approve.',
      v_old_value, p_new_value, p_control_key, p_control_type
    ),
    'financial_control_change'
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_financial_adjustment(
  p_reference_type text,
  p_reference_id text,
  p_entries jsonb,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  INSERT INTO public.financial_adjustment_requests (
    reference_type, reference_id, entries, reason, requested_by, metadata
  ) VALUES (
    p_reference_type, p_reference_id, p_entries, p_reason, auth.uid(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  PERFORM public.notify_platform_admins_financial_review(
    auth.uid(),
    'Ledger adjustment awaiting approval',
    format(
      'Adjustment for %s / %s needs checker approval. Open Financial controls → Adjustments.',
      p_reference_type, p_reference_id
    ),
    'financial_adjustment'
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_financial_adjustment(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_adjustment_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) < 10 THEN
    RAISE EXCEPTION 'rejection reason must be at least 10 characters when provided';
  END IF;

  SELECT * INTO v_request
  FROM public.financial_adjustment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending adjustment not found';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'maker cannot reject own financial adjustment — cancel instead';
  END IF;

  UPDATE public.financial_adjustment_requests
  SET status = 'rejected',
      approved_by = auth.uid(),
      decided_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'rejection_reason', COALESCE(v_reason, 'Rejected by checker')
      )
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_adjustment_rejected',
    'financial_adjustment_request', p_request_id,
    jsonb_build_object(
      'maker', v_request.requested_by,
      'reference_type', v_request.reference_type,
      'reference_id', v_request.reference_id,
      'reason', v_request.reason,
      'rejection_reason', COALESCE(v_reason, 'Rejected by checker')
    )
  );

  RETURN jsonb_build_object('rejected', true, 'request_id', p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_financial_adjustment(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_adjustment_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  SELECT * INTO v_request
  FROM public.financial_adjustment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending adjustment not found';
  END IF;
  IF v_request.requested_by <> auth.uid() THEN
    RAISE EXCEPTION 'only the requesting admin can cancel this adjustment';
  END IF;

  UPDATE public.financial_adjustment_requests
  SET status = 'cancelled',
      decided_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_adjustment_cancelled',
    'financial_adjustment_request', p_request_id,
    jsonb_build_object(
      'reference_type', v_request.reference_type,
      'reference_id', v_request.reference_id,
      'reason', v_request.reason
    )
  );

  RETURN jsonb_build_object('cancelled', true, 'request_id', p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_financial_controls_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_preflight jsonb := '{}'::jsonb;
  v_admin_count int := 0;
  v_pending_controls int := 0;
  v_pending_adjustments int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  IF to_regprocedure('public.financial_runtime_preflight()') IS NOT NULL THEN
    v_preflight := public.financial_runtime_preflight();
  END IF;

  SELECT count(*)::int INTO v_admin_count
  FROM public.user_roles
  WHERE role = 'admin';

  SELECT count(*)::int INTO v_pending_controls
  FROM public.financial_control_change_requests
  WHERE status = 'pending';

  SELECT count(*)::int INTO v_pending_adjustments
  FROM public.financial_adjustment_requests
  WHERE status = 'pending';

  RETURN jsonb_build_object(
    'platform_admin_count', v_admin_count,
    'pending_control_count', v_pending_controls,
    'pending_adjustment_count', v_pending_adjustments,
    'pending_total_count', v_pending_controls + v_pending_adjustments,
    'feature_flags', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', f.key,
          'enabled', f.enabled,
          'description', f.description,
          'updated_at', f.updated_at,
          'updated_by', f.updated_by
        )
        ORDER BY f.key
      )
      FROM public.financial_feature_flags f
    ), '[]'::jsonb),
    'configurations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', c.key,
          'value', c.value,
          'description', c.description,
          'updated_at', c.updated_at,
          'updated_by', c.updated_by
        )
        ORDER BY c.key
      )
      FROM public.financial_configuration c
    ), '[]'::jsonb),
    'pending_requests', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.requested_at DESC)
      FROM (
        SELECT
          r.id,
          r.control_type,
          r.control_key,
          r.old_value,
          r.new_value,
          r.reason,
          r.status,
          r.requested_by,
          r.approved_by,
          r.requested_at,
          r.decided_at,
          r.expires_at,
          r.metadata,
          pr.name AS requester_name,
          pa.name AS approver_name
        FROM public.financial_control_change_requests r
        LEFT JOIN public.profiles pr ON pr.id = r.requested_by
        LEFT JOIN public.profiles pa ON pa.id = r.approved_by
        WHERE r.status = 'pending'
        ORDER BY r.requested_at DESC
      ) x
    ), '[]'::jsonb),
    'recent_requests', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.decided_at DESC NULLS LAST)
      FROM (
        SELECT
          r.id,
          r.control_type,
          r.control_key,
          r.old_value,
          r.new_value,
          r.reason,
          r.status,
          r.requested_by,
          r.approved_by,
          r.requested_at,
          r.decided_at,
          r.expires_at,
          r.metadata,
          pr.name AS requester_name,
          pa.name AS approver_name
        FROM public.financial_control_change_requests r
        LEFT JOIN public.profiles pr ON pr.id = r.requested_by
        LEFT JOIN public.profiles pa ON pa.id = r.approved_by
        WHERE r.status <> 'pending'
        ORDER BY r.decided_at DESC NULLS LAST, r.requested_at DESC
        LIMIT 60
      ) x
    ), '[]'::jsonb),
    'pending_adjustments', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.requested_at DESC)
      FROM (
        SELECT
          r.id,
          r.reference_type,
          r.reference_id,
          r.entries,
          r.reason,
          r.status,
          r.requested_by,
          r.approved_by,
          r.requested_at,
          r.decided_at,
          r.journal_transaction_id,
          r.metadata,
          pr.name AS requester_name,
          pa.name AS approver_name
        FROM public.financial_adjustment_requests r
        LEFT JOIN public.profiles pr ON pr.id = r.requested_by
        LEFT JOIN public.profiles pa ON pa.id = r.approved_by
        WHERE r.status = 'pending'
        ORDER BY r.requested_at DESC
      ) x
    ), '[]'::jsonb),
    'recent_adjustments', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.decided_at DESC NULLS LAST)
      FROM (
        SELECT
          r.id,
          r.reference_type,
          r.reference_id,
          r.entries,
          r.reason,
          r.status,
          r.requested_by,
          r.approved_by,
          r.requested_at,
          r.decided_at,
          r.journal_transaction_id,
          r.metadata,
          pr.name AS requester_name,
          pa.name AS approver_name
        FROM public.financial_adjustment_requests r
        LEFT JOIN public.profiles pr ON pr.id = r.requested_by
        LEFT JOIN public.profiles pa ON pa.id = r.approved_by
        WHERE r.status <> 'pending'
        ORDER BY r.decided_at DESC NULLS LAST, r.requested_at DESC
        LIMIT 40
      ) x
    ), '[]'::jsonb),
    'preflight', v_preflight,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_financial_adjustment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_financial_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_financial_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_financial_adjustment(uuid) TO authenticated;
