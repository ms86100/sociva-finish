
-- ═══════════════════════════════════════════════════════════════
-- Batch 6: Tasks 7, 9, 12, 13
-- ═══════════════════════════════════════════════════════════════

-- ── Task 7: Stock Watchlist ──
CREATE TABLE public.stock_watchlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz DEFAULT NULL,
  UNIQUE(user_id, product_id)
);

ALTER TABLE public.stock_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own watchlist" ON public.stock_watchlist
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_stock_watchlist_product ON public.stock_watchlist (product_id, notified_at);

-- Trigger: notify watchers when product becomes available
CREATE OR REPLACE FUNCTION public.notify_stock_watchers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_available = false AND NEW.is_available = true THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    SELECT sw.user_id,
      '🔔 Back in Stock!',
      NEW.name || ' is available again. Order now!',
      'stock_alert',
      '/category/' || NEW.category,
      jsonb_build_object('productId', NEW.id, 'productName', NEW.name)
    FROM stock_watchlist sw
    WHERE sw.product_id = NEW.id AND sw.notified_at IS NULL;

    UPDATE stock_watchlist SET notified_at = now()
    WHERE product_id = NEW.id AND notified_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_notify_stock_watchers
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.notify_stock_watchers();

-- ── Task 9: Seller Reputation Ledger ──
CREATE TABLE public.seller_reputation_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  event_type text NOT NULL,
  event_detail jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  is_positive boolean NOT NULL DEFAULT true
);

ALTER TABLE public.seller_reputation_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read reputation" ON public.seller_reputation_ledger
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_reputation_seller ON public.seller_reputation_ledger (seller_id, occurred_at DESC);

-- Validation trigger for event_type
CREATE OR REPLACE FUNCTION public.validate_reputation_event_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.event_type NOT IN ('order_completed', 'order_cancelled', 'dispute_resolved', 'dispute_lost', 'response_fast', 'response_slow') THEN
    RAISE EXCEPTION 'Invalid reputation event_type: %', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_reputation_event
  BEFORE INSERT OR UPDATE ON public.seller_reputation_ledger
  FOR EACH ROW EXECUTE FUNCTION public.validate_reputation_event_type();

-- Auto-log reputation events on order status changes
CREATE OR REPLACE FUNCTION public.log_reputation_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  IF NEW.status = 'completed' OR NEW.status = 'delivered' THEN
    INSERT INTO seller_reputation_ledger (seller_id, event_type, is_positive, event_detail)
    VALUES (NEW.seller_id, 'order_completed', true, jsonb_build_object('order_id', NEW.id));
  ELSIF NEW.status = 'cancelled' THEN
    INSERT INTO seller_reputation_ledger (seller_id, event_type, is_positive, event_detail)
    VALUES (NEW.seller_id, 'order_cancelled', false, jsonb_build_object('order_id', NEW.id));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_log_reputation_on_order
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_reputation_on_order();

-- ── Task 13: Collective Buying ──
CREATE TABLE public.collective_buy_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  target_quantity integer NOT NULL DEFAULT 10,
  current_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

ALTER TABLE public.collective_buy_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view group buys" ON public.collective_buy_requests
  FOR SELECT TO authenticated
  USING (society_id = public.get_user_society_id(auth.uid()));

CREATE POLICY "Society members can create group buys" ON public.collective_buy_requests
  FOR INSERT TO authenticated
  WITH CHECK (society_id = public.get_user_society_id(auth.uid()) AND created_by = auth.uid());

CREATE INDEX idx_collective_buy_society ON public.collective_buy_requests (society_id, status, expires_at DESC);

-- Validation for status
CREATE OR REPLACE FUNCTION public.validate_collective_buy_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('active', 'fulfilled', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid collective buy status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_collective_buy_status
  BEFORE INSERT OR UPDATE ON public.collective_buy_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_collective_buy_status();

CREATE TABLE public.collective_buy_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.collective_buy_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  quantity integer NOT NULL DEFAULT 1,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, user_id)
);

ALTER TABLE public.collective_buy_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view participants" ON public.collective_buy_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collective_buy_requests cbr
      WHERE cbr.id = collective_buy_participants.request_id
        AND cbr.society_id = public.get_user_society_id(auth.uid())
    )
  );

CREATE POLICY "Users can join group buys" ON public.collective_buy_participants
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can leave group buys" ON public.collective_buy_participants
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Auto-update current_quantity on participant changes
CREATE OR REPLACE FUNCTION public.update_collective_buy_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _request_id uuid;
  _new_qty integer;
  _target integer;
BEGIN
  _request_id := COALESCE(NEW.request_id, OLD.request_id);
  
  SELECT COALESCE(SUM(quantity), 0) INTO _new_qty
  FROM collective_buy_participants WHERE request_id = _request_id;

  SELECT target_quantity INTO _target
  FROM collective_buy_requests WHERE id = _request_id;

  UPDATE collective_buy_requests
  SET current_quantity = _new_qty,
      status = CASE WHEN _new_qty >= _target THEN 'fulfilled' ELSE status END
  WHERE id = _request_id;

  -- Notify seller when target reached
  IF _new_qty >= _target THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path)
    SELECT sp.user_id,
      '🎉 Group Buy Target Reached!',
      p.name || ' group buy hit ' || _target || ' units!',
      'collective_buy',
      '/seller-dashboard'
    FROM collective_buy_requests cbr
    JOIN products p ON p.id = cbr.product_id
    JOIN seller_profiles sp ON sp.id = p.seller_id
    WHERE cbr.id = _request_id AND cbr.status = 'fulfilled';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER trg_update_collective_qty
  AFTER INSERT OR DELETE ON public.collective_buy_participants
  FOR EACH ROW EXECUTE FUNCTION public.update_collective_buy_quantity();
