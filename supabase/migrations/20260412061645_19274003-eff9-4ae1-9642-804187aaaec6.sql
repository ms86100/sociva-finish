
-- 1. Add auto_accept_enabled to seller_profiles
ALTER TABLE public.seller_profiles
ADD COLUMN IF NOT EXISTS auto_accept_enabled boolean NOT NULL DEFAULT false;

-- 2. Create seller_quick_replies table
CREATE TABLE IF NOT EXISTS public.seller_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  message_text text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers can view own quick replies"
  ON public.seller_quick_replies FOR SELECT
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Sellers can insert own quick replies"
  ON public.seller_quick_replies FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Sellers can update own quick replies"
  ON public.seller_quick_replies FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Sellers can delete own quick replies"
  ON public.seller_quick_replies FOR DELETE
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

-- 3. Seed default quick replies on new seller profile
CREATE OR REPLACE FUNCTION public.seed_seller_quick_replies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.seller_quick_replies (seller_id, label, message_text, sort_order) VALUES
    (NEW.id, 'Order preparing', 'Your order is being prepared and will be ready soon!', 1),
    (NEW.id, 'Out of stock', 'Sorry, this item is currently out of stock. Would you like an alternative?', 2),
    (NEW.id, 'Delivery time', 'Your order will be delivered within 30-45 minutes.', 3),
    (NEW.id, 'Thank you', 'Thank you for your order! We appreciate your business.', 4),
    (NEW.id, 'Store hours', 'Our store hours are displayed on our profile. Feel free to order during those times!', 5);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_quick_replies
  AFTER INSERT ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_seller_quick_replies();

-- 4. Auto-accept trigger on orders
CREATE OR REPLACE FUNCTION public.handle_order_auto_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_auto_accept
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_auto_accept();

-- 5. Customer directory RPC
CREATE OR REPLACE FUNCTION public.get_seller_customer_directory(p_seller_id uuid)
RETURNS TABLE (
  buyer_id uuid,
  full_name text,
  avatar_url text,
  order_count bigint,
  total_spent numeric,
  last_order_date timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.buyer_id,
    COALESCE(p.name, 'Customer') AS full_name,
    p.avatar_url,
    count(o.id) AS order_count,
    COALESCE(sum(o.total_amount), 0) AS total_spent,
    max(o.created_at) AS last_order_date
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.buyer_id
  WHERE o.seller_id = p_seller_id
    AND o.status NOT IN ('cancelled', 'returned')
  GROUP BY o.buyer_id, p.name, p.avatar_url
  ORDER BY count(o.id) DESC;
$$;
