-- Accurate seller settlement totals (not truncated by PostgREST row limits).
-- Supports single-store and portfolio (uuid[]) scopes.

CREATE OR REPLACE FUNCTION public.get_seller_settlement_totals(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN jsonb_build_object('total_settled', 0, 'total_pending', 0);
  END IF;

  -- Caller must own every seller_id (or be admin)
  IF EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) AS sid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = sid.id AND sp.user_id = v_uid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT jsonb_build_object(
    'total_settled', COALESCE(SUM(ss.net_amount) FILTER (WHERE ss.settlement_status = 'settled'), 0),
    'total_pending', COALESCE(SUM(ss.net_amount) FILTER (WHERE ss.settlement_status IS DISTINCT FROM 'settled'), 0)
  )
  INTO v_result
  FROM public.seller_settlements ss
  WHERE ss.seller_id = ANY (p_seller_ids);

  RETURN COALESCE(v_result, jsonb_build_object('total_settled', 0, 'total_pending', 0));
END;
$$;

COMMENT ON FUNCTION public.get_seller_settlement_totals(uuid[]) IS
  'Sum of seller_settlements net_amount by settled vs non-settled for one or more owned stores.';

GRANT EXECUTE ON FUNCTION public.get_seller_settlement_totals(uuid[]) TO authenticated;
