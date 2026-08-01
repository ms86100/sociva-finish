
-- Phase C: Order Suggestions table
CREATE TABLE public.order_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  trigger_type text NOT NULL DEFAULT 'time_pattern',
  day_of_week int,
  time_bucket int,
  confidence_score numeric(3,2) DEFAULT 0.50,
  suggested_at timestamptz,
  dismissed boolean DEFAULT false,
  acted_on boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.order_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own suggestions" ON public.order_suggestions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users update own suggestions" ON public.order_suggestions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Phase E: Delivery Time Stats table
CREATE TABLE public.delivery_time_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES public.seller_profiles(id) ON DELETE CASCADE NOT NULL,
  society_id uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  time_bucket int,
  avg_prep_minutes numeric(6,1) DEFAULT 0,
  avg_delivery_minutes numeric(6,1) DEFAULT 0,
  sample_count int DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(seller_id, society_id, time_bucket)
);

ALTER TABLE public.delivery_time_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read delivery stats" ON public.delivery_time_stats
  FOR SELECT TO authenticated USING (true);

-- Phase E: Trigger to update delivery_time_stats on delivery completion
CREATE OR REPLACE FUNCTION public.fn_update_delivery_time_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order record;
  v_prep_minutes numeric;
  v_delivery_minutes numeric;
  v_hour int;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Get order info
  SELECT o.seller_id, o.society_id, o.created_at
  INTO v_order
  FROM public.orders o WHERE o.id = NEW.order_id;

  IF v_order IS NULL THEN RETURN NEW; END IF;

  -- Calculate prep time (order created → pickup)
  IF NEW.pickup_at IS NOT NULL THEN
    v_prep_minutes := EXTRACT(EPOCH FROM (NEW.pickup_at - v_order.created_at)) / 60.0;
  END IF;

  -- Calculate delivery time (pickup → delivered)
  IF NEW.pickup_at IS NOT NULL AND NEW.delivered_at IS NOT NULL THEN
    v_delivery_minutes := EXTRACT(EPOCH FROM (NEW.delivered_at - NEW.pickup_at)) / 60.0;
  END IF;

  v_hour := EXTRACT(HOUR FROM v_order.created_at);

  -- Upsert stats with running average
  INSERT INTO public.delivery_time_stats (seller_id, society_id, time_bucket, avg_prep_minutes, avg_delivery_minutes, sample_count, updated_at)
  VALUES (
    v_order.seller_id, v_order.society_id, v_hour,
    COALESCE(v_prep_minutes, 0), COALESCE(v_delivery_minutes, 0), 1, now()
  )
  ON CONFLICT (seller_id, society_id, time_bucket) DO UPDATE SET
    avg_prep_minutes = (delivery_time_stats.avg_prep_minutes * delivery_time_stats.sample_count + COALESCE(v_prep_minutes, delivery_time_stats.avg_prep_minutes)) / (delivery_time_stats.sample_count + 1),
    avg_delivery_minutes = (delivery_time_stats.avg_delivery_minutes * delivery_time_stats.sample_count + COALESCE(v_delivery_minutes, delivery_time_stats.avg_delivery_minutes)) / (delivery_time_stats.sample_count + 1),
    sample_count = delivery_time_stats.sample_count + 1,
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_update_delivery_time_stats failed: %', SQLERRM;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_update_delivery_time_stats
  AFTER UPDATE ON public.delivery_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_delivery_time_stats();
