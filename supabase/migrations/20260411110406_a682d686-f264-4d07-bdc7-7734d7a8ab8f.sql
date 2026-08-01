
-- 1. Add reliability score columns to seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS reliability_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_updated_at timestamptz;

-- 2. Composite reliability score calculator
CREATE OR REPLACE FUNCTION public.compute_seller_reliability_score(_seller_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total_orders integer;
  _completed integer;
  _cancelled integer;
  _on_time_pct numeric;
  _avg_response numeric;
  _repeat_pct numeric;
  _rating numeric;
  _score numeric;
BEGIN
  -- Order counts
  SELECT 
    COUNT(*) FILTER (WHERE status NOT IN ('payment_pending')),
    COUNT(*) FILTER (WHERE status IN ('completed', 'delivered')),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO _total_orders, _completed, _cancelled
  FROM public.orders WHERE seller_id = _seller_id;

  -- If no orders, return 50 (neutral)
  IF _total_orders = 0 THEN
    UPDATE public.seller_profiles SET reliability_score = 50, reliability_updated_at = now() WHERE id = _seller_id;
    RETURN 50;
  END IF;

  -- On-time delivery pct
  SELECT COALESCE(on_time_delivery_pct, 80) INTO _on_time_pct
  FROM public.seller_profiles WHERE id = _seller_id;

  -- Response time score (0-100, faster = higher)
  SELECT CASE 
    WHEN COALESCE(avg_response_minutes, 0) = 0 THEN 70
    WHEN avg_response_minutes <= 5 THEN 100
    WHEN avg_response_minutes <= 15 THEN 90
    WHEN avg_response_minutes <= 30 THEN 75
    WHEN avg_response_minutes <= 60 THEN 60
    ELSE 40
  END INTO _avg_response
  FROM public.seller_profiles WHERE id = _seller_id;

  -- Repeat customer rate
  SELECT CASE 
    WHEN COUNT(DISTINCT buyer_id) = 0 THEN 0
    ELSE (COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id))
  END INTO _repeat_pct
  FROM (
    SELECT buyer_id, COUNT(*) as cnt
    FROM public.orders 
    WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')
    GROUP BY buyer_id
  ) sub;

  -- Rating
  SELECT COALESCE(rating, 3.5) * 20 INTO _rating  -- Convert 0-5 to 0-100
  FROM public.seller_profiles WHERE id = _seller_id;

  -- Weighted composite
  _score := ROUND(
    (CASE WHEN _total_orders > 0 THEN (_completed::numeric / _total_orders * 100) ELSE 0 END) * 0.30 +  -- fulfillment
    LEAST(_on_time_pct, 100) * 0.20 +  -- on-time
    _avg_response * 0.15 +  -- response speed
    LEAST(_repeat_pct, 100) * 0.15 +  -- retention
    LEAST(_rating, 100) * 0.10 +  -- rating
    (100 - LEAST((_cancelled::numeric / GREATEST(_total_orders, 1) * 100), 100)) * 0.10  -- cancellation penalty
  , 1);

  -- Clamp 0-100
  _score := GREATEST(0, LEAST(100, _score));

  -- Persist
  UPDATE public.seller_profiles 
  SET reliability_score = _score, reliability_updated_at = now() 
  WHERE id = _seller_id;

  RETURN _score;
END;
$$;

-- 3. Batch refresh all sellers
CREATE OR REPLACE FUNCTION public.refresh_seller_reliability_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sid uuid;
BEGIN
  FOR _sid IN SELECT id FROM public.seller_profiles WHERE verification_status = 'approved'
  LOOP
    PERFORM compute_seller_reliability_score(_sid);
  END LOOP;
END;
$$;

-- 4. Auto-recalculate on order terminal states
CREATE OR REPLACE FUNCTION public.fn_update_reliability_on_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'delivered', 'cancelled') AND 
     (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM compute_seller_reliability_score(NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_reliability_on_order ON public.orders;
CREATE TRIGGER trg_update_reliability_on_order
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_reliability_on_order_change();

-- 5. RPC for UI breakdown
CREATE OR REPLACE FUNCTION public.get_seller_reliability_breakdown(_seller_id uuid)
RETURNS TABLE(
  overall_score numeric,
  fulfillment_score numeric,
  ontime_score numeric,
  response_score numeric,
  retention_score numeric,
  rating_score numeric,
  cancellation_score numeric,
  total_orders bigint,
  completed_orders bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total bigint;
  _completed bigint;
  _cancelled bigint;
  _on_time numeric;
  _resp numeric;
  _repeat numeric;
  _rating numeric;
BEGIN
  SELECT 
    COUNT(*) FILTER (WHERE status NOT IN ('payment_pending')),
    COUNT(*) FILTER (WHERE status IN ('completed', 'delivered')),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO _total, _completed, _cancelled
  FROM public.orders WHERE seller_id = _seller_id;

  IF _total = 0 THEN
    RETURN QUERY SELECT 50::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT COALESCE(on_time_delivery_pct, 80) INTO _on_time FROM public.seller_profiles WHERE id = _seller_id;

  SELECT CASE 
    WHEN COALESCE(avg_response_minutes, 0) = 0 THEN 70
    WHEN avg_response_minutes <= 5 THEN 100
    WHEN avg_response_minutes <= 15 THEN 90
    WHEN avg_response_minutes <= 30 THEN 75
    WHEN avg_response_minutes <= 60 THEN 60
    ELSE 40
  END INTO _resp FROM public.seller_profiles WHERE id = _seller_id;

  SELECT CASE 
    WHEN COUNT(DISTINCT buyer_id) = 0 THEN 0
    ELSE (COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id))
  END INTO _repeat
  FROM (SELECT buyer_id, COUNT(*) as cnt FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed','delivered') GROUP BY buyer_id) sub;

  SELECT COALESCE(rating, 3.5) * 20 INTO _rating FROM public.seller_profiles WHERE id = _seller_id;

  RETURN QUERY SELECT
    COALESCE((SELECT reliability_score FROM public.seller_profiles WHERE id = _seller_id), 50),
    ROUND(_completed::numeric / GREATEST(_total, 1) * 100, 1),
    ROUND(LEAST(_on_time, 100), 1),
    ROUND(_resp, 1),
    ROUND(LEAST(_repeat, 100), 1),
    ROUND(LEAST(_rating, 100), 1),
    ROUND(100 - LEAST(_cancelled::numeric / GREATEST(_total, 1) * 100, 100), 1),
    _total,
    _completed;
END;
$$;

-- 6. Seed initial scores for existing sellers
SELECT compute_seller_reliability_score(id) FROM public.seller_profiles WHERE verification_status = 'approved';
