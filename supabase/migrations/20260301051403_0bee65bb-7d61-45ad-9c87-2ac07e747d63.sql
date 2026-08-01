
-- Phase 1: Category-Aware Status Flow Configuration

-- 1. Add new enum values for order_status
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'on_the_way';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'assigned';

-- 2. Add new statuses to order_status_config
INSERT INTO public.order_status_config (status_key, label, color, sort_order) VALUES
  ('on_the_way', 'On The Way', 'bg-blue-100 text-blue-800', 14),
  ('arrived', 'Arrived', 'bg-teal-100 text-teal-800', 15),
  ('assigned', 'Assigned', 'bg-indigo-100 text-indigo-800', 16)
ON CONFLICT (status_key) DO NOTHING;

-- 3. Create category_status_flows table
CREATE TABLE public.category_status_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_group text NOT NULL,
  transaction_type text NOT NULL,
  status_key text NOT NULL,
  sort_order int NOT NULL,
  actor text NOT NULL DEFAULT 'seller',
  is_terminal boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_group, transaction_type, status_key)
);

ALTER TABLE public.category_status_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_status_flows readable by all authenticated"
  ON public.category_status_flows FOR SELECT
  TO authenticated
  USING (true);

-- 4. Seed: Food/Grocery flow (cart_purchase)
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('food', 'cart_purchase', 'placed', 1, 'buyer', false),
  ('food', 'cart_purchase', 'accepted', 2, 'seller', false),
  ('food', 'cart_purchase', 'preparing', 3, 'seller', false),
  ('food', 'cart_purchase', 'ready', 4, 'seller', false),
  ('food', 'cart_purchase', 'picked_up', 5, 'delivery', false),
  ('food', 'cart_purchase', 'on_the_way', 6, 'delivery', false),
  ('food', 'cart_purchase', 'delivered', 7, 'system', false),
  ('food', 'cart_purchase', 'completed', 8, 'system', true),
  ('food', 'cart_purchase', 'cancelled', 99, 'seller', true);

-- Grocery uses same flow as food
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('grocery', 'cart_purchase', 'placed', 1, 'buyer', false),
  ('grocery', 'cart_purchase', 'accepted', 2, 'seller', false),
  ('grocery', 'cart_purchase', 'preparing', 3, 'seller', false),
  ('grocery', 'cart_purchase', 'ready', 4, 'seller', false),
  ('grocery', 'cart_purchase', 'picked_up', 5, 'delivery', false),
  ('grocery', 'cart_purchase', 'on_the_way', 6, 'delivery', false),
  ('grocery', 'cart_purchase', 'delivered', 7, 'system', false),
  ('grocery', 'cart_purchase', 'completed', 8, 'system', true),
  ('grocery', 'cart_purchase', 'cancelled', 99, 'seller', true);

-- Shopping uses same flow
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('shopping', 'cart_purchase', 'placed', 1, 'buyer', false),
  ('shopping', 'cart_purchase', 'accepted', 2, 'seller', false),
  ('shopping', 'cart_purchase', 'preparing', 3, 'seller', false),
  ('shopping', 'cart_purchase', 'ready', 4, 'seller', false),
  ('shopping', 'cart_purchase', 'picked_up', 5, 'delivery', false),
  ('shopping', 'cart_purchase', 'on_the_way', 6, 'delivery', false),
  ('shopping', 'cart_purchase', 'delivered', 7, 'system', false),
  ('shopping', 'cart_purchase', 'completed', 8, 'system', true),
  ('shopping', 'cart_purchase', 'cancelled', 99, 'seller', true);

-- 5. Seed: Services flow (request_service)
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('services', 'request_service', 'enquired', 1, 'buyer', false),
  ('services', 'request_service', 'accepted', 2, 'seller', false),
  ('services', 'request_service', 'assigned', 3, 'seller', false),
  ('services', 'request_service', 'on_the_way', 4, 'delivery', false),
  ('services', 'request_service', 'arrived', 5, 'delivery', false),
  ('services', 'request_service', 'in_progress', 6, 'seller', false),
  ('services', 'request_service', 'completed', 7, 'system', true),
  ('services', 'request_service', 'cancelled', 99, 'seller', true);

-- Personal services
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('personal', 'request_service', 'enquired', 1, 'buyer', false),
  ('personal', 'request_service', 'accepted', 2, 'seller', false),
  ('personal', 'request_service', 'assigned', 3, 'seller', false),
  ('personal', 'request_service', 'on_the_way', 4, 'delivery', false),
  ('personal', 'request_service', 'arrived', 5, 'delivery', false),
  ('personal', 'request_service', 'in_progress', 6, 'seller', false),
  ('personal', 'request_service', 'completed', 7, 'system', true),
  ('personal', 'request_service', 'cancelled', 99, 'seller', true);

-- Professional services
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('professional', 'request_service', 'enquired', 1, 'buyer', false),
  ('professional', 'request_service', 'accepted', 2, 'seller', false),
  ('professional', 'request_service', 'assigned', 3, 'seller', false),
  ('professional', 'request_service', 'on_the_way', 4, 'delivery', false),
  ('professional', 'request_service', 'arrived', 5, 'delivery', false),
  ('professional', 'request_service', 'in_progress', 6, 'seller', false),
  ('professional', 'request_service', 'completed', 7, 'system', true),
  ('professional', 'request_service', 'cancelled', 99, 'seller', true);

-- 6. Seed: Classes/Bookings flow (book_slot)
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('classes', 'book_slot', 'enquired', 1, 'buyer', false),
  ('classes', 'book_slot', 'accepted', 2, 'seller', false),
  ('classes', 'book_slot', 'scheduled', 3, 'seller', false),
  ('classes', 'book_slot', 'in_progress', 4, 'seller', false),
  ('classes', 'book_slot', 'completed', 5, 'system', true),
  ('classes', 'book_slot', 'cancelled', 99, 'seller', true);

-- Events
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('events', 'book_slot', 'enquired', 1, 'buyer', false),
  ('events', 'book_slot', 'accepted', 2, 'seller', false),
  ('events', 'book_slot', 'scheduled', 3, 'seller', false),
  ('events', 'book_slot', 'in_progress', 4, 'seller', false),
  ('events', 'book_slot', 'completed', 5, 'system', true),
  ('events', 'book_slot', 'cancelled', 99, 'seller', true);

-- Pets
INSERT INTO public.category_status_flows (parent_group, transaction_type, status_key, sort_order, actor, is_terminal) VALUES
  ('pets', 'request_service', 'enquired', 1, 'buyer', false),
  ('pets', 'request_service', 'accepted', 2, 'seller', false),
  ('pets', 'request_service', 'assigned', 3, 'seller', false),
  ('pets', 'request_service', 'on_the_way', 4, 'delivery', false),
  ('pets', 'request_service', 'arrived', 5, 'delivery', false),
  ('pets', 'request_service', 'in_progress', 6, 'seller', false),
  ('pets', 'request_service', 'completed', 7, 'system', true),
  ('pets', 'request_service', 'cancelled', 99, 'seller', true);

-- 7. Create get_allowed_transitions function
CREATE OR REPLACE FUNCTION public.get_allowed_transitions(
  _order_id uuid,
  _actor text DEFAULT 'seller'
)
RETURNS TABLE(status_key text, sort_order int, actor text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current_status text;
  _current_sort int;
  _parent_group text;
  _transaction_type text;
  _fulfillment_type text;
BEGIN
  -- Get order info + seller's primary_group
  SELECT o.status::text, o.fulfillment_type,
         COALESCE(sp.primary_group, 'food'),
         COALESCE(
           CASE 
             WHEN o.order_type = 'enquiry' THEN 
               CASE WHEN sp.primary_group IN ('classes', 'events') THEN 'book_slot' ELSE 'request_service' END
             ELSE 'cart_purchase'
           END, 'cart_purchase'
         )
  INTO _current_status, _fulfillment_type, _parent_group, _transaction_type
  FROM orders o
  JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF _current_status IS NULL THEN
    RETURN;
  END IF;

  -- Get current sort_order
  SELECT csf.sort_order INTO _current_sort
  FROM category_status_flows csf
  WHERE csf.parent_group = _parent_group
    AND csf.transaction_type = _transaction_type
    AND csf.status_key = _current_status;

  IF _current_sort IS NULL THEN
    RETURN;
  END IF;

  -- Return next valid transition(s) for the given actor
  RETURN QUERY
  SELECT csf.status_key, csf.sort_order, csf.actor
  FROM category_status_flows csf
  WHERE csf.parent_group = _parent_group
    AND csf.transaction_type = _transaction_type
    AND csf.sort_order = _current_sort + 1
    AND (_actor = 'any' OR csf.actor = _actor);
END;
$$;

-- 8. Create status transition validation trigger
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _parent_group text;
  _transaction_type text;
  _current_sort int;
  _new_sort int;
  _new_actor text;
BEGIN
  -- Skip if status didn't change
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allow cancellation from any state (by seller or system)
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Get seller's primary_group to determine flow
  SELECT COALESCE(sp.primary_group, 'food'),
         COALESCE(
           CASE 
             WHEN OLD.order_type = 'enquiry' THEN 
               CASE WHEN sp.primary_group IN ('classes', 'events') THEN 'book_slot' ELSE 'request_service' END
             ELSE 'cart_purchase'
           END, 'cart_purchase'
         )
  INTO _parent_group, _transaction_type
  FROM seller_profiles sp
  WHERE sp.id = OLD.seller_id;

  -- If no flow found, allow (backwards compatibility)
  IF _parent_group IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get sort orders for current and new status
  SELECT csf.sort_order INTO _current_sort
  FROM category_status_flows csf
  WHERE csf.parent_group = _parent_group
    AND csf.transaction_type = _transaction_type
    AND csf.status_key = OLD.status::text;

  SELECT csf.sort_order, csf.actor INTO _new_sort, _new_actor
  FROM category_status_flows csf
  WHERE csf.parent_group = _parent_group
    AND csf.transaction_type = _transaction_type
    AND csf.status_key = NEW.status::text;

  -- If statuses not in flow config, allow (backwards compat)
  IF _current_sort IS NULL OR _new_sort IS NULL THEN
    RETURN NEW;
  END IF;

  -- Prevent jumping statuses (must go to next step only)
  IF _new_sort != _current_sort + 1 THEN
    RAISE EXCEPTION 'Invalid status transition: cannot jump from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();
