-- Admin Financial Controls UI: snapshot + reject/cancel for maker-checker workflow

CREATE OR REPLACE FUNCTION public.admin_get_financial_controls_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_preflight jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  IF to_regprocedure('public.financial_runtime_preflight()') IS NOT NULL THEN
    v_preflight := public.financial_runtime_preflight();
  END IF;

  RETURN jsonb_build_object(
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
    'preflight', v_preflight,
    'generated_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_financial_control_change(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_control_change_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) < 10 THEN
    RAISE EXCEPTION 'rejection reason must be at least 10 characters when provided';
  END IF;

  SELECT * INTO v_request
  FROM public.financial_control_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending request not found';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'maker cannot reject own financial control change — cancel instead';
  END IF;
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at <= now() THEN
    RAISE EXCEPTION 'financial control request expired';
  END IF;

  UPDATE public.financial_control_change_requests
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
    auth.uid(), 'financial_control_change_rejected',
    'financial_control_change_request', p_request_id,
    jsonb_build_object(
      'maker', v_request.requested_by,
      'control_type', v_request.control_type,
      'control_key', v_request.control_key,
      'old_value', v_request.old_value,
      'new_value', v_request.new_value,
      'reason', v_request.reason,
      'rejection_reason', COALESCE(v_reason, 'Rejected by checker')
    )
  );

  RETURN jsonb_build_object('rejected', true, 'request_id', p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_financial_control_change(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_control_change_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  SELECT * INTO v_request
  FROM public.financial_control_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending request not found';
  END IF;
  IF v_request.requested_by <> auth.uid() THEN
    RAISE EXCEPTION 'only the requesting admin can cancel this change';
  END IF;

  UPDATE public.financial_control_change_requests
  SET status = 'cancelled',
      decided_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_control_change_cancelled',
    'financial_control_change_request', p_request_id,
    jsonb_build_object(
      'control_type', v_request.control_type,
      'control_key', v_request.control_key,
      'old_value', v_request.old_value,
      'new_value', v_request.new_value,
      'reason', v_request.reason
    )
  );

  RETURN jsonb_build_object('cancelled', true, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_financial_controls_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_financial_control_change(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_financial_control_change(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_financial_controls_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_financial_control_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_financial_control_change(uuid) TO authenticated;
