
-- 1. Loyalty points ledger
CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  points integer NOT NULL,
  type text NOT NULL DEFAULT 'earned' CHECK (type IN ('earned', 'redeemed', 'bonus', 'expired', 'adjusted')),
  source text NOT NULL DEFAULT 'order' CHECK (source IN ('order', 'review', 'referral', 'signup', 'bonus', 'redemption', 'admin')),
  reference_id text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own loyalty points"
  ON public.loyalty_points FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_loyalty_points_user ON public.loyalty_points(user_id, created_at DESC);
CREATE INDEX idx_loyalty_points_ref ON public.loyalty_points(reference_id) WHERE reference_id IS NOT NULL;

-- 2. Get balance RPC
CREATE OR REPLACE FUNCTION public.get_loyalty_balance(_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(points), 0)::integer
  FROM public.loyalty_points
  WHERE user_id = COALESCE(_user_id, auth.uid());
$$;

-- 3. Get history RPC
CREATE OR REPLACE FUNCTION public.get_loyalty_history(_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, points integer, type text, source text, description text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT lp.id, lp.points, lp.type, lp.source, lp.description, lp.created_at
  FROM public.loyalty_points lp
  WHERE lp.user_id = auth.uid()
  ORDER BY lp.created_at DESC
  LIMIT _limit;
$$;

-- 4. Earn points on delivery (1 point per ₹10)
CREATE OR REPLACE FUNCTION public.fn_earn_loyalty_on_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _points integer;
  _already_earned boolean;
BEGIN
  IF NEW.status IN ('delivered', 'completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Check if already awarded
    SELECT EXISTS(
      SELECT 1 FROM loyalty_points WHERE reference_id = NEW.id::text AND source = 'order' AND type = 'earned'
    ) INTO _already_earned;
    
    IF NOT _already_earned AND NEW.total_amount > 0 THEN
      _points := GREATEST(FLOOR(NEW.total_amount / 10)::integer, 1);
      
      INSERT INTO loyalty_points (user_id, points, type, source, reference_id, description)
      VALUES (NEW.buyer_id, _points, 'earned', 'order', NEW.id::text,
        'Earned ' || _points || ' points on order');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earn_loyalty_on_delivery ON public.orders;
CREATE TRIGGER trg_earn_loyalty_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION fn_earn_loyalty_on_delivery();

-- 5. Earn bonus points on review
CREATE OR REPLACE FUNCTION public.fn_earn_loyalty_on_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _already boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM loyalty_points WHERE reference_id = NEW.id::text AND source = 'review'
  ) INTO _already;
  
  IF NOT _already THEN
    INSERT INTO loyalty_points (user_id, points, type, source, reference_id, description)
    VALUES (NEW.buyer_id, 10, 'bonus', 'review', NEW.id::text, '+10 points for writing a review');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earn_loyalty_on_review ON public.reviews;
CREATE TRIGGER trg_earn_loyalty_on_review
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION fn_earn_loyalty_on_review();

-- 6. Redeem points RPC
CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(
  _points integer,
  _order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _balance integer;
  _discount numeric;
BEGIN
  IF _points <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be positive');
  END IF;

  -- Get current balance
  SELECT COALESCE(SUM(points), 0) INTO _balance
  FROM loyalty_points WHERE user_id = auth.uid();

  IF _balance < _points THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient points', 'balance', _balance);
  END IF;

  -- 1 point = ₹1 discount
  _discount := _points;

  -- Deduct points
  INSERT INTO loyalty_points (user_id, points, type, source, reference_id, description)
  VALUES (auth.uid(), -_points, 'redeemed', 'redemption', _order_id::text,
    'Redeemed ' || _points || ' points for ₹' || _discount || ' discount');

  RETURN jsonb_build_object('success', true, 'discount', _discount, 'remaining_balance', _balance - _points);
END;
$$;

-- 7. Award signup bonus to existing users who have 0 points
INSERT INTO loyalty_points (user_id, points, type, source, description)
SELECT DISTINCT o.buyer_id, 50, 'bonus', 'signup', 'Welcome bonus — 50 points!'
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM loyalty_points lp WHERE lp.user_id = o.buyer_id)
GROUP BY o.buyer_id;

-- 8. Retroactively award points for past delivered orders
INSERT INTO loyalty_points (user_id, points, type, source, reference_id, description)
SELECT o.buyer_id, GREATEST(FLOOR(o.total_amount / 10)::integer, 1), 'earned', 'order', o.id::text,
  'Earned points on past order'
FROM orders o
WHERE o.status IN ('delivered', 'completed')
  AND o.total_amount > 0
  AND NOT EXISTS (SELECT 1 FROM loyalty_points lp WHERE lp.reference_id = o.id::text AND lp.source = 'order');
