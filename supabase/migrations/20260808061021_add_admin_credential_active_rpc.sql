-- Toggle credential availability without exposing or rewriting its secret value.
-- Direct authenticated UPDATE is intentionally unusable because admin_settings
-- has no SELECT policy; PostgREST UPDATE therefore affects zero visible rows.
CREATE OR REPLACE FUNCTION public.set_admin_credential_active(
  p_key text,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_settings
  SET
    is_active = p_is_active,
    updated_at = now()
  WHERE key = p_key;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'credential_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.write_audit_event(
    'credential_activation_update',
    'admin_settings',
    p_key,
    NULL,
    jsonb_build_object('is_active', p_is_active)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_credential_active(text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_credential_active(text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_admin_credential_active(text, boolean) IS
  'Admin-only activation toggle that never returns or rewrites credential values.';
