
-- ============================================================
-- Phase 1.1: Create category_status_transitions table
-- ============================================================
CREATE TABLE public.category_status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_group text NOT NULL,
  transaction_type text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  allowed_actor text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (parent_group, transaction_type, from_status, to_status, allowed_actor)
);

ALTER TABLE public.category_status_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read transitions"
  ON public.category_status_transitions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage transitions"
  ON public.category_status_transitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_cst_lookup
  ON public.category_status_transitions (parent_group, transaction_type, from_status);

-- ============================================================
-- Phase 1.2: Add display columns to category_status_flows
-- ============================================================
ALTER TABLE public.category_status_flows
  ADD COLUMN IF NOT EXISTS display_label text,
  ADD COLUMN IF NOT EXISTS color text DEFAULT 'bg-gray-100 text-gray-600',
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS buyer_hint text;

-- ============================================================
-- Phase 1.5: Create validate_order_status_transition trigger
-- Uses transition table for validation + actor enforcement
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
  _actors text[];
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allow any → cancelled for admin/service_role
  IF NEW.status::text = 'cancelled' THEN
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Resolve parent_group from seller
  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Resolve transaction_type from order
  IF NEW.order_type = 'enquiry' THEN
    IF _parent_group IN ('classes', 'events') THEN
      _txn_type := 'book_slot';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF NEW.fulfillment_type IN ('self_pickup', 'seller_delivery') THEN
    _txn_type := 'self_fulfillment';
  ELSE
    _txn_type := 'cart_purchase';
  END IF;

  -- Check transition validity in transitions table
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = COALESCE(_parent_group, 'default')
      AND transaction_type = _txn_type
      AND from_status = OLD.status::text
      AND to_status = NEW.status::text
  ) INTO _valid;

  -- Fallback to 'default' parent_group if specific not found
  IF NOT _valid AND _parent_group IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = 'default'
        AND transaction_type = _txn_type
        AND from_status = OLD.status::text
        AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%"', OLD.status, NEW.status;
  END IF;

  -- Actor enforcement: collect allowed actors for this transition
  SELECT array_agg(DISTINCT cst.allowed_actor) INTO _actors
  FROM public.category_status_transitions cst
  WHERE (cst.parent_group = COALESCE(_parent_group, 'default') OR cst.parent_group = 'default')
    AND cst.transaction_type = _txn_type
    AND cst.from_status = OLD.status::text
    AND cst.to_status = NEW.status::text;

  -- If only delivery/system actors allowed, enforce caller check
  IF _actors IS NOT NULL
     AND NOT ('seller' = ANY(_actors) OR 'buyer' = ANY(_actors) OR 'admin' = ANY(_actors))
     AND ('delivery' = ANY(_actors) OR 'system' = ANY(_actors)) THEN
    IF coalesce(current_setting('app.delivery_sync', true), '') != 'true'
       AND current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status transition to "%" can only be performed by the delivery/system', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger on orders table (BEFORE UPDATE)
DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON public.orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();
