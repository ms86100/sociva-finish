
-- Phase 1: Add layout_type to parent_groups
ALTER TABLE public.parent_groups
  ADD COLUMN IF NOT EXISTS layout_type text NOT NULL DEFAULT 'ecommerce';

-- Add price_prefix and placeholder_emoji to category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS price_prefix text,
  ADD COLUMN IF NOT EXISTS placeholder_emoji text;

-- Seed layout_type for existing parent groups
UPDATE public.parent_groups SET layout_type = 'food' WHERE slug IN ('food', 'grocery');
UPDATE public.parent_groups SET layout_type = 'service' WHERE slug IN ('services', 'personal', 'professional', 'events', 'classes', 'pets');

-- Add low_stock_threshold setting
INSERT INTO public.admin_settings (key, value, description, is_active)
VALUES ('low_stock_threshold', '5', 'Show low stock warning when product quantity is at or below this value', true)
ON CONFLICT (key) DO NOTHING;

-- Add fulfillment_mode_labels setting (JSON map)
INSERT INTO public.admin_settings (key, value, description, is_active)
VALUES ('fulfillment_labels', '{"delivery":"🚚 Delivery","self_pickup":"📍 Pickup","both":"🚚 Delivery & Pickup"}', 'Display labels for fulfillment modes', true)
ON CONFLICT (key) DO NOTHING;

-- Validate layout_type
CREATE OR REPLACE FUNCTION public.validate_layout_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.layout_type NOT IN ('ecommerce', 'food', 'service') THEN
    RAISE EXCEPTION 'Invalid layout_type: %. Must be ecommerce, food, or service', NEW.layout_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_layout_type
  BEFORE INSERT OR UPDATE ON public.parent_groups
  FOR EACH ROW EXECUTE FUNCTION public.validate_layout_type();
