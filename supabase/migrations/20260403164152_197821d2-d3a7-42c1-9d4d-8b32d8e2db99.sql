
-- ================================================================
-- 1. Create canonical action_type_workflow_map table
-- ================================================================
CREATE TABLE public.action_type_workflow_map (
  action_type text PRIMARY KEY,
  transaction_type text NOT NULL,
  checkout_mode text NOT NULL DEFAULT 'cart',
  creates_order boolean NOT NULL DEFAULT true,
  requires_price boolean NOT NULL DEFAULT true,
  requires_availability boolean NOT NULL DEFAULT false,
  cta_label text NOT NULL DEFAULT 'Add to Cart',
  cta_short_label text NOT NULL DEFAULT 'ADD',
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT valid_checkout_mode CHECK (checkout_mode IN ('cart', 'booking', 'inquiry', 'contact'))
);

-- Seed all known action types
INSERT INTO public.action_type_workflow_map (action_type, transaction_type, checkout_mode, creates_order, requires_price, requires_availability, cta_label, cta_short_label) VALUES
  ('add_to_cart',     'cart_purchase',    'cart',     true,  true,  false, 'Add to Cart',      'ADD'),
  ('buy_now',         'cart_purchase',    'cart',     true,  true,  false, 'Buy Now',           'BUY'),
  ('book',            'service_booking',  'booking',  true,  true,  true,  'Book Now',          'Book'),
  ('request_service', 'request_service',  'inquiry',  true,  false, false, 'Request Service',   'Request'),
  ('request_quote',   'request_service',  'inquiry',  true,  false, false, 'Request Quote',     'Quote'),
  ('contact_seller',  'contact_enquiry',  'contact',  false, false, false, 'Contact Seller',    'Contact'),
  ('schedule_visit',  'service_booking',  'booking',  true,  false, false, 'Schedule Visit',    'Visit'),
  ('make_offer',      'request_service',  'inquiry',  true,  false, false, 'Make an Offer',     'Offer');

-- RLS: readable by everyone, writable by nobody (admin manages via migrations/insert tool)
ALTER TABLE public.action_type_workflow_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read action_type_workflow_map" ON public.action_type_workflow_map FOR SELECT USING (true);

-- ================================================================
-- 2. Add default_action_type to category_config
-- ================================================================
ALTER TABLE public.category_config ADD COLUMN IF NOT EXISTS default_action_type text;

-- ================================================================
-- 3. Create category_allowed_action_types join table
-- ================================================================
CREATE TABLE public.category_allowed_action_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_config_id uuid NOT NULL REFERENCES public.category_config(id) ON DELETE CASCADE,
  action_type text NOT NULL REFERENCES public.action_type_workflow_map(action_type) ON DELETE CASCADE,
  UNIQUE (category_config_id, action_type)
);

ALTER TABLE public.category_allowed_action_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read category_allowed_action_types" ON public.category_allowed_action_types FOR SELECT USING (true);

-- ================================================================
-- 4. Fix map_transaction_type_to_action_type — add missing mappings
-- ================================================================
CREATE OR REPLACE FUNCTION public.map_transaction_type_to_action_type(_transaction_type text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Now reads from canonical mapping table with fallback
  RETURN COALESCE(
    (SELECT atm.action_type FROM public.action_type_workflow_map atm WHERE atm.transaction_type = _transaction_type LIMIT 1),
    'add_to_cart'
  );
END;
$$;

-- ================================================================
-- 5. Replace product trigger: only set default on INSERT, never override on UPDATE
-- ================================================================
CREATE OR REPLACE FUNCTION public.set_product_action_type_from_category()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  _default_action text;
  _allowed text[];
BEGIN
  -- On INSERT: set default action_type from category if not explicitly provided
  IF TG_OP = 'INSERT' THEN
    IF NEW.action_type IS NULL OR NEW.action_type = 'add_to_cart' THEN
      -- Check category_config.default_action_type first, then derive from transaction_type
      SELECT COALESCE(cc.default_action_type, public.map_transaction_type_to_action_type(cc.transaction_type))
        INTO _default_action
      FROM public.category_config cc
      WHERE cc.category::text = NEW.category::text
      LIMIT 1;

      IF _default_action IS NOT NULL THEN
        NEW.action_type := _default_action;
      END IF;
    END IF;
  END IF;

  -- Validate action_type exists in canonical mapping
  IF NOT EXISTS (SELECT 1 FROM public.action_type_workflow_map WHERE action_type = NEW.action_type) THEN
    RAISE EXCEPTION 'Invalid action_type: %. Must be one of the registered action types.', NEW.action_type;
  END IF;

  -- Validate against category allowed list (if configured)
  SELECT array_agg(cat.action_type) INTO _allowed
  FROM public.category_allowed_action_types cat
  JOIN public.category_config cc ON cc.id = cat.category_config_id
  WHERE cc.category::text = NEW.category::text;

  IF _allowed IS NOT NULL AND array_length(_allowed, 1) > 0 AND NEW.action_type <> ALL(_allowed) THEN
    RAISE EXCEPTION 'action_type "%" is not allowed for category "%". Allowed: %', NEW.action_type, NEW.category, _allowed;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger: only fires on INSERT now (removed UPDATE OF category, action_type)
DROP TRIGGER IF EXISTS trg_set_product_action_type_from_category ON public.products;
CREATE TRIGGER trg_set_product_action_type_from_category
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_product_action_type_from_category();

-- Also add validation-only trigger on UPDATE
CREATE OR REPLACE FUNCTION public.validate_product_action_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  _allowed text[];
BEGIN
  -- Validate action_type exists in canonical mapping
  IF NOT EXISTS (SELECT 1 FROM public.action_type_workflow_map WHERE action_type = NEW.action_type) THEN
    RAISE EXCEPTION 'Invalid action_type: %. Must be one of the registered action types.', NEW.action_type;
  END IF;

  -- Validate against category allowed list (if configured)
  SELECT array_agg(cat.action_type) INTO _allowed
  FROM public.category_allowed_action_types cat
  JOIN public.category_config cc ON cc.id = cat.category_config_id
  WHERE cc.category::text = NEW.category::text;

  IF _allowed IS NOT NULL AND array_length(_allowed, 1) > 0 AND NEW.action_type <> ALL(_allowed) THEN
    RAISE EXCEPTION 'action_type "%" is not allowed for category "%". Allowed: %', NEW.action_type, NEW.category, _allowed;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_action_type
  BEFORE UPDATE OF action_type, category ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_action_type();

-- ================================================================
-- 6. Drop the mass-override trigger (category changes no longer affect products)
-- ================================================================
DROP TRIGGER IF EXISTS trg_sync_products_action_type_on_category_tx_change ON public.category_config;
DROP FUNCTION IF EXISTS public.sync_products_action_type_on_category_tx_change();

-- ================================================================
-- 7. Backfill default_action_type on category_config from transaction_type
-- ================================================================
UPDATE public.category_config cc
SET default_action_type = (
  SELECT atm.action_type
  FROM public.action_type_workflow_map atm
  WHERE atm.transaction_type = cc.transaction_type
  LIMIT 1
)
WHERE cc.default_action_type IS NULL;
