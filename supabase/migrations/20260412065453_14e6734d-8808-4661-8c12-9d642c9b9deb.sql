
-- 1. Add auto_accepted column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_accepted boolean NOT NULL DEFAULT false;

-- 2. Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_orders_auto_accepted ON public.orders (auto_accepted) WHERE auto_accepted = true;

-- 3. Update handle_order_auto_accept to set the flag + log activity
CREATE OR REPLACE FUNCTION public.handle_order_auto_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller RECORD;
  v_today_count int;
  v_current_day text;
BEGIN
  -- Only act on newly placed orders
  IF NEW.status <> 'placed' THEN
    RETURN NEW;
  END IF;

  -- Get seller profile
  SELECT auto_accept_enabled, operating_days, availability_start, availability_end, daily_order_limit
  INTO v_seller
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF NOT FOUND OR NOT v_seller.auto_accept_enabled THEN
    RETURN NEW;
  END IF;

  -- Check operating day
  v_current_day := lower(trim(to_char(now() AT TIME ZONE 'Asia/Kolkata', 'Day')));
  IF v_seller.operating_days IS NOT NULL AND array_length(v_seller.operating_days, 1) > 0 THEN
    IF NOT (v_current_day = ANY(v_seller.operating_days)) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Check operating hours
  IF v_seller.availability_start IS NOT NULL AND v_seller.availability_end IS NOT NULL THEN
    IF (now() AT TIME ZONE 'Asia/Kolkata')::time < v_seller.availability_start
       OR (now() AT TIME ZONE 'Asia/Kolkata')::time > v_seller.availability_end THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Check daily order limit
  IF v_seller.daily_order_limit IS NOT NULL AND v_seller.daily_order_limit > 0 THEN
    SELECT count(*) INTO v_today_count
    FROM public.orders
    WHERE seller_id = NEW.seller_id
      AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status NOT IN ('cancelled', 'returned');

    IF v_today_count >= v_seller.daily_order_limit THEN
      RETURN NEW;
    END IF;
  END IF;

  -- All checks passed — auto-accept
  NEW.status := 'preparing';
  NEW.auto_accepted := true;
  RETURN NEW;
END;
$function$;

-- 4. Create an AFTER INSERT trigger to log auto-accept activity
CREATE OR REPLACE FUNCTION public.log_auto_accept_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.auto_accepted = true THEN
    INSERT INTO public.order_activity (order_id, actor_type, action, details)
    VALUES (
      NEW.id,
      'system',
      'auto_accepted',
      jsonb_build_object(
        'message', 'Order was automatically accepted by the system',
        'from_status', 'placed',
        'to_status', 'preparing'
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_auto_accept_activity ON public.orders;
CREATE TRIGGER trg_log_auto_accept_activity
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.auto_accepted = true)
  EXECUTE FUNCTION public.log_auto_accept_activity();
