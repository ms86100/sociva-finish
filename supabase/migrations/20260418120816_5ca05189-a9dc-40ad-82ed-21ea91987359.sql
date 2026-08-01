CREATE OR REPLACE FUNCTION public.fn_upsert_seller_metrics(
  _seller_id uuid,
  _avg_response_seconds integer,
  _missed_orders_count integer,
  _total_orders_30d integer,
  _last_active_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.seller_performance_metrics
    (seller_id, avg_response_seconds, missed_orders_count, total_orders_30d, last_active_at, updated_at)
  VALUES
    (_seller_id, _avg_response_seconds, _missed_orders_count, _total_orders_30d, _last_active_at, now())
  ON CONFLICT (seller_id) DO UPDATE
    SET avg_response_seconds = EXCLUDED.avg_response_seconds,
        missed_orders_count = EXCLUDED.missed_orders_count,
        total_orders_30d = EXCLUDED.total_orders_30d,
        last_active_at = EXCLUDED.last_active_at,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_upsert_seller_metrics(uuid, integer, integer, integer, timestamptz) TO service_role, authenticated;