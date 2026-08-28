-- Restore seller refund visibility: is_seller_for_refund lost authenticated EXECUTE
-- during financial function ACL hardening (proname ILIKE '%refund%').

GRANT EXECUTE ON FUNCTION public.is_seller_for_refund(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_seller_refund_requests(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) AS sid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = sid AND sp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
    FROM (
      SELECT
        rr.id,
        rr.order_id,
        rr.status,
        rr.refund_state,
        rr.category,
        rr.reason,
        rr.amount,
        rr.created_at,
        rr.seller_id
      FROM public.refund_requests rr
      WHERE rr.seller_id = ANY(p_seller_ids)
      ORDER BY rr.created_at DESC
      LIMIT 100
    ) r
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_seller_refund_requests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_seller_refund_requests(uuid[]) TO authenticated;
