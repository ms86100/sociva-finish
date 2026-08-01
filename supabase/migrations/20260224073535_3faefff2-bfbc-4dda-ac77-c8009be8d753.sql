
-- =====================================================
-- Attribute Block Library & Seller Form Configs
-- Plug-and-play listing form extension system
-- =====================================================

-- 1. Attribute Block Library (platform-defined)
CREATE TABLE public.attribute_block_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  block_type text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  icon text,
  category_hints text[] DEFAULT '{}',
  schema jsonb NOT NULL DEFAULT '{}',
  renderer_type text NOT NULL DEFAULT 'key_value',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Validate renderer_type
CREATE OR REPLACE FUNCTION public.validate_renderer_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.renderer_type NOT IN ('key_value', 'table', 'tags', 'badge_list', 'text') THEN
    RAISE EXCEPTION 'Invalid renderer_type: %. Must be key_value, table, tags, badge_list, or text', NEW.renderer_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_renderer_type
  BEFORE INSERT OR UPDATE ON public.attribute_block_library
  FOR EACH ROW EXECUTE FUNCTION public.validate_renderer_type();

-- RLS for attribute_block_library
ALTER TABLE public.attribute_block_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active blocks"
  ON public.attribute_block_library FOR SELECT
  USING (is_active = true OR public.is_admin(auth.uid()));

CREATE POLICY "Only admins can manage blocks"
  ON public.attribute_block_library FOR ALL
  USING (public.is_admin(auth.uid()));

-- 2. Seller Form Configs (per-seller block arrangement)
CREATE TABLE public.seller_form_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  category text,
  blocks jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one config per seller per category (NULL category = default)
CREATE UNIQUE INDEX idx_seller_form_configs_unique
  ON public.seller_form_configs (seller_id, COALESCE(category, '__default__'));

-- RLS for seller_form_configs
ALTER TABLE public.seller_form_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers can view own form configs"
  ON public.seller_form_configs FOR SELECT TO authenticated
  USING (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "Sellers can insert own form configs"
  ON public.seller_form_configs FOR INSERT TO authenticated
  WITH CHECK (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Sellers can update own form configs"
  ON public.seller_form_configs FOR UPDATE TO authenticated
  USING (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Sellers can delete own form configs"
  ON public.seller_form_configs FOR DELETE TO authenticated
  USING (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
  );

-- 3. Seed the 12 attribute blocks
INSERT INTO public.attribute_block_library (block_type, display_name, description, icon, category_hints, schema, renderer_type, display_order) VALUES
('variants', 'Variants', 'Add size, color, material or other options', '🎨', ARRAY['clothing', 'electronics', 'furniture'], '{"type":"object","properties":{"options":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"values":{"type":"array","items":{"type":"string"}}}}}}}', 'tags', 1),
('size_chart', 'Size Chart', 'Add a size measurement table', '📏', ARRAY['clothing', 'footwear'], '{"type":"object","properties":{"rows":{"type":"array","items":{"type":"object","properties":{"size":{"type":"string"},"chest":{"type":"string"},"waist":{"type":"string"},"length":{"type":"string"}}}}}}', 'table', 2),
('inventory', 'Inventory', 'Track stock count and low-stock alerts', '📦', ARRAY['groceries', 'electronics'], '{"type":"object","properties":{"stock_count":{"type":"number"},"low_stock_alert":{"type":"number"},"unlimited":{"type":"boolean"}}}', 'key_value', 3),
('service_duration', 'Service Duration', 'Specify how long the service takes', '⏱️', ARRAY['ac_service', 'plumber', 'electrician'], '{"type":"object","properties":{"duration_minutes":{"type":"number"},"unit":{"type":"string"}}}', 'badge_list', 4),
('pricing_model', 'Pricing Model', 'Fixed, per hour, per day, or quote-based', '💰', ARRAY['yoga', 'carpenter'], '{"type":"object","properties":{"model":{"type":"string"},"rate":{"type":"number"},"unit":{"type":"string"}}}', 'key_value', 5),
('location', 'Location / Service Area', 'Where the service is available', '📍', ARRAY['plumber', 'electrician', 'carpenter'], '{"type":"object","properties":{"area_type":{"type":"string"},"description":{"type":"string"}}}', 'text', 6),
('availability', 'Availability Window', 'When this item or service is available', '📅', ARRAY['home_food', 'bakery'], '{"type":"object","properties":{"available_from":{"type":"string"},"available_until":{"type":"string"},"seasonal_note":{"type":"string"}}}', 'key_value', 7),
('delivery_fulfillment', 'Delivery & Fulfillment', 'How the buyer gets the product or service', '🚚', ARRAY['groceries', 'electronics'], '{"type":"object","properties":{"methods":{"type":"array","items":{"type":"string"}}}}', 'badge_list', 8),
('custom_attributes', 'Custom Details', 'Add any custom key-value details', '🔧', ARRAY[]::text[], '{"type":"object","properties":{"entries":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"value":{"type":"string"}}}}}}', 'key_value', 9),
('deposit', 'Advance / Deposit', 'Security deposit or advance payment info', '🔒', ARRAY['furniture', 'electronics'], '{"type":"object","properties":{"deposit_type":{"type":"string"},"amount":{"type":"number"},"percentage":{"type":"number"}}}', 'key_value', 10),
('return_policy', 'Return / Cancellation', 'Return or cancellation policy details', '↩️', ARRAY['clothing', 'electronics', 'furniture'], '{"type":"object","properties":{"policy":{"type":"string"},"details":{"type":"string"}}}', 'text', 11),
('compliance', 'Certifications', 'Upload or mention licenses and certifications', '✅', ARRAY['home_food', 'bakery', 'beauty'], '{"type":"object","properties":{"certifications":{"type":"array","items":{"type":"string"}}}}', 'badge_list', 12);
