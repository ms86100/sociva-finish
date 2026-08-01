-- 1. Deferred constraint trigger: ensure availability exists for booking-type products
CREATE OR REPLACE FUNCTION public.validate_product_availability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  _requires boolean;
BEGIN
  SELECT requires_availability INTO _requires
  FROM public.action_type_workflow_map
  WHERE action_type = NEW.action_type;

  IF _requires = true AND NOT EXISTS (
    SELECT 1 FROM public.service_availability_schedules
    WHERE seller_id = NEW.seller_id
  ) THEN
    RAISE EXCEPTION 'action_type "%" requires availability schedules to be configured', NEW.action_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validate_product_availability
  AFTER INSERT OR UPDATE ON public.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_availability();

-- 2. Seed category_allowed_action_types
-- Food categories → add_to_cart, buy_now
INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, at.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('add_to_cart'), ('buy_now')) AS at(action_type)
WHERE cc.category IN ('home_food', 'snacks', 'beverages', 'catering', 'sweets_desserts', 'homemade_products', 'party_bulk_orders', 'specialty_food')
ON CONFLICT DO NOTHING;

-- Service/wellness categories → book, contact_seller, request_service
INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, at.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('book'), ('contact_seller'), ('request_service')) AS at(action_type)
WHERE cc.category IN ('yoga', 'dance', 'fitness', 'ayurveda', 'salon', 'beauty', 'mehendi', 'tailoring', 'music', 'art_craft', 'tuition', 'language', 'coaching', 'daycare', 'nanny', 'photography')
ON CONFLICT DO NOTHING;

-- Home services / professional → request_quote, contact_seller, request_service
INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, at.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('request_quote'), ('contact_seller'), ('request_service')) AS at(action_type)
WHERE cc.category IN ('electrician', 'plumber', 'carpenter', 'ac_service', 'pest_control', 'appliance_repair', 'maid', 'cook', 'driver', 'laundry', 'decoration', 'dj_music')
ON CONFLICT DO NOTHING;

-- Product/resale categories → add_to_cart, contact_seller
INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, at.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('add_to_cart'), ('contact_seller')) AS at(action_type)
WHERE cc.category IN ('furniture', 'electronics', 'books', 'toys', 'kitchen', 'clothing')
ON CONFLICT DO NOTHING;

-- Free sharing → contact_seller
INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, at.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('contact_seller')) AS at(action_type)
WHERE cc.category = 'free_sharing'
ON CONFLICT DO NOTHING;