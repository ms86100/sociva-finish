
-- ═══════════════════════════════════════════════════════════════
-- Batch 5: Tasks 5, 6, 11
-- ═══════════════════════════════════════════════════════════════

-- ── Task 6: Search Demand Log ──
CREATE TABLE public.search_demand_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  search_term text NOT NULL,
  category text DEFAULT NULL,
  searched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_demand_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log searches" ON public.search_demand_log
  FOR INSERT TO authenticated
  WITH CHECK (society_id = public.get_user_society_id(auth.uid()));

CREATE POLICY "Admins can read search demand" ON public.search_demand_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.society_admins WHERE user_id = auth.uid() AND society_id = search_demand_log.society_id AND deactivated_at IS NULL)
  );

CREATE INDEX idx_search_demand_society_term ON public.search_demand_log (society_id, searched_at DESC);

-- ── Task 6: RPC get_unmet_demand ──
CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid, _seller_categories text[] DEFAULT NULL)
RETURNS TABLE (
  search_term text,
  search_count bigint,
  last_searched timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
  SELECT
    sdl.search_term,
    COUNT(*) AS search_count,
    MAX(sdl.searched_at) AS last_searched
  FROM search_demand_log sdl
  WHERE sdl.society_id = _society_id
    AND sdl.searched_at > now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM products p
      JOIN seller_profiles sp ON sp.id = p.seller_id
      WHERE sp.society_id = _society_id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (p.name ILIKE '%' || sdl.search_term || '%' OR p.description ILIKE '%' || sdl.search_term || '%')
    )
  GROUP BY sdl.search_term
  HAVING COUNT(*) >= 2
  ORDER BY search_count DESC
  LIMIT 10
$$;

-- ── Task 11: Price History ──
CREATE TABLE public.price_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_price numeric NOT NULL,
  new_price numeric NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read price history" ON public.price_history
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_price_history_product ON public.price_history (product_id, changed_at DESC);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_stable_since timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.log_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price AND OLD.price IS NOT NULL AND NEW.price IS NOT NULL THEN
    INSERT INTO price_history (product_id, old_price, new_price, changed_by)
    VALUES (NEW.id, OLD.price, NEW.price, NEW.seller_id);
    NEW.price_stable_since := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_log_price_change
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_price_change();

-- ── Task 5: RPC get_seller_demand_stats ──
CREATE OR REPLACE FUNCTION public.get_seller_demand_stats(_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  _society_id uuid;
  _active_buyers bigint;
  _view_count bigint;
  _order_count bigint;
  _conversion numeric;
BEGIN
  SELECT society_id INTO _society_id FROM seller_profiles WHERE id = _seller_id;

  SELECT COUNT(DISTINCT o.buyer_id) INTO _active_buyers
  FROM orders o
  JOIN profiles p ON p.id = o.buyer_id
  WHERE p.society_id = _society_id
    AND o.created_at > now() - interval '30 days'
    AND o.status != 'cancelled';

  SELECT COALESCE(SUM(ca.view_count), 0) INTO _view_count
  FROM card_analytics ca
  WHERE ca.seller_id = _seller_id
    AND ca.recorded_at > now() - interval '30 days';

  SELECT COUNT(*) INTO _order_count
  FROM orders o
  WHERE o.seller_id = _seller_id
    AND o.created_at > now() - interval '30 days'
    AND o.status != 'cancelled';

  _conversion := CASE WHEN _view_count > 0 THEN ROUND((_order_count::numeric / _view_count) * 100, 1) ELSE 0 END;

  RETURN jsonb_build_object(
    'active_buyers_in_society', _active_buyers,
    'view_count', _view_count,
    'order_count', _order_count,
    'conversion_rate', _conversion
  );
END;
$function$;

-- Seller-scoped read for demand insights
CREATE POLICY "Sellers can read unmet demand via RPC" ON public.search_demand_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.user_id = auth.uid() AND sp.society_id = search_demand_log.society_id
    )
  );
