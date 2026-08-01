
-- Add seller transparency columns
ALTER TABLE public.seller_profiles 
  ADD COLUMN IF NOT EXISTS avg_response_minutes integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_order_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_rate numeric DEFAULT 0;

-- Create a function to recompute seller stats from real order data
CREATE OR REPLACE FUNCTION public.recompute_seller_stats(_seller_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _completed integer;
  _cancelled integer;
  _total integer;
  _avg_response numeric;
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

  UPDATE seller_profiles SET
    completed_order_count = _completed,
    cancellation_rate = CASE WHEN _total > 0 THEN ROUND((_cancelled::numeric / _total) * 100, 1) ELSE 0 END,
    avg_response_minutes = _avg_response
  WHERE id = _seller_id;
END;
$$;

-- Trigger to update seller stats on order status change
CREATE OR REPLACE FUNCTION public.trg_update_seller_stats_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recompute_seller_stats(NEW.seller_id);
    -- Update last_active_at for seller
    UPDATE seller_profiles SET last_active_at = now() WHERE id = NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_status_seller_stats
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_seller_stats_on_order();

-- Also update last_active when a seller updates their profile or products
CREATE OR REPLACE FUNCTION public.trg_seller_activity_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.last_active_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seller_profile_activity
  BEFORE UPDATE ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seller_activity_timestamp();

-- Backfill existing seller stats from real data
DO $$
DECLARE
  _seller_id uuid;
BEGIN
  FOR _seller_id IN SELECT id FROM seller_profiles WHERE verification_status = 'approved'
  LOOP
    PERFORM public.recompute_seller_stats(_seller_id);
  END LOOP;
END;
$$;
