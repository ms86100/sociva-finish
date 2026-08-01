-- Task 8: Add on_time_delivery_pct column to seller_profiles
ALTER TABLE public.seller_profiles 
  ADD COLUMN IF NOT EXISTS on_time_delivery_pct numeric DEFAULT NULL;

-- Update recompute_seller_stats to also compute on-time delivery percentage
CREATE OR REPLACE FUNCTION public.recompute_seller_stats(_seller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _completed integer;
  _cancelled integer;
  _total integer;
  _avg_response numeric;
  _on_time_pct numeric;
  _sla_hours integer;
BEGIN
  -- Count completed orders
  SELECT COUNT(*) INTO _completed
  FROM orders WHERE seller_id = _seller_id AND status = 'completed';

  -- Count cancelled orders
  SELECT COUNT(*) INTO _cancelled
  FROM orders WHERE seller_id = _seller_id AND status = 'cancelled';

  _total := _completed + _cancelled;

  -- Compute average response time (placed -> accepted) in minutes
  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60))::integer
  INTO _avg_response
  FROM orders
  WHERE seller_id = _seller_id AND status IN ('accepted', 'preparing', 'ready', 'completed', 'delivered')
    AND updated_at > created_at;

  -- Get SLA hours from system settings (default 4 hours)
  SELECT COALESCE(value::integer, 4) INTO _sla_hours
  FROM system_settings WHERE key = 'delivery_sla_hours';
  IF _sla_hours IS NULL THEN _sla_hours := 4; END IF;

  -- Compute on-time delivery percentage
  SELECT CASE 
    WHEN COUNT(*) >= 5 THEN
      ROUND(
        (COUNT(*) FILTER (
          WHERE da.delivered_at IS NOT NULL 
            AND da.delivered_at <= da.created_at + (_sla_hours || ' hours')::interval
        )::numeric / COUNT(*)) * 100, 
        1
      )
    ELSE NULL
  END INTO _on_time_pct
  FROM delivery_assignments da
  JOIN orders o ON o.id = da.order_id
  WHERE o.seller_id = _seller_id
    AND da.status = 'delivered'
    AND da.delivered_at IS NOT NULL;

  UPDATE seller_profiles SET
    completed_order_count = _completed,
    cancellation_rate = CASE WHEN _total > 0 THEN ROUND((_cancelled::numeric / _total) * 100, 1) ELSE 0 END,
    avg_response_minutes = _avg_response,
    on_time_delivery_pct = _on_time_pct
  WHERE id = _seller_id;
END;
$function$;