
-- ═══════════════════════════════════════════════════
-- 1. Add layout_type to category_config (category-level control)
-- ═══════════════════════════════════════════════════
ALTER TABLE public.category_config
ADD COLUMN IF NOT EXISTS layout_type text NOT NULL DEFAULT 'ecommerce';

-- Populate layout_type from parent_groups.layout_type for existing rows
UPDATE public.category_config cc
SET layout_type = COALESCE(pg.layout_type, 'ecommerce')
FROM public.parent_groups pg
WHERE pg.slug = cc.parent_group;

-- Validate layout_type on category_config
CREATE OR REPLACE FUNCTION public.validate_category_layout_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.layout_type NOT IN ('ecommerce', 'food', 'service') THEN
    RAISE EXCEPTION 'Invalid layout_type on category_config: %. Must be ecommerce, food, or service', NEW.layout_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_category_layout_type
BEFORE INSERT OR UPDATE ON public.category_config
FOR EACH ROW
EXECUTE FUNCTION public.validate_category_layout_type();

-- ═══════════════════════════════════════════════════
-- 2. Create badge_config table
-- ═══════════════════════════════════════════════════
CREATE TABLE public.badge_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tag_key text NOT NULL UNIQUE,
  badge_label text NOT NULL,
  color text NOT NULL DEFAULT 'bg-primary text-primary-foreground',
  priority integer NOT NULL DEFAULT 100,
  layout_visibility text[] NOT NULL DEFAULT ARRAY['ecommerce', 'food', 'service'],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.badge_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Badge config is readable by everyone"
ON public.badge_config FOR SELECT USING (true);

CREATE POLICY "Only admins can modify badge config"
ON public.badge_config FOR ALL
USING (public.is_admin(auth.uid()));

-- Seed default badge configs
INSERT INTO public.badge_config (tag_key, badge_label, color, priority, layout_visibility) VALUES
  ('bestseller', 'Bestseller', 'bg-accent text-accent-foreground', 10, ARRAY['ecommerce', 'food', 'service']),
  ('low_stock', 'Only {stock} left!', 'bg-destructive text-destructive-foreground', 20, ARRAY['ecommerce', 'food']),
  ('new_arrival', 'New', 'bg-info text-primary-foreground', 30, ARRAY['ecommerce', 'food', 'service']),
  ('trending', 'Trending', 'bg-primary text-primary-foreground', 40, ARRAY['ecommerce', 'food', 'service']);

-- ═══════════════════════════════════════════════════
-- 3. Create system_settings table
-- ═══════════════════════════════════════════════════
CREATE TABLE public.system_settings (
  key text NOT NULL PRIMARY KEY,
  value text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System settings readable by everyone"
ON public.system_settings FOR SELECT USING (true);

CREATE POLICY "Only admins can modify system settings"
ON public.system_settings FOR ALL
USING (public.is_admin(auth.uid()));

-- Seed required keys
INSERT INTO public.system_settings (key, value, description) VALUES
  ('low_stock_threshold', '5', 'Products with stock <= this show scarcity badge'),
  ('default_currency', 'INR', 'ISO 4217 currency code'),
  ('currency_symbol', '₹', 'Display symbol for currency'),
  ('max_badges_per_card', '2', 'Maximum badges shown on product card'),
  ('enable_scarcity', 'true', 'Enable low stock warnings'),
  ('enable_pulse_animation', 'true', 'Enable pulse animation on low stock badge');

-- ═══════════════════════════════════════════════════
-- 4. Create marketplace_events table for analytics
-- ═══════════════════════════════════════════════════
CREATE TABLE public.marketplace_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  seller_id uuid,
  category text,
  layout_type text,
  event_type text NOT NULL,
  user_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_events ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events
CREATE POLICY "Users can insert own events"
ON public.marketplace_events FOR INSERT
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Admins can read all events
CREATE POLICY "Admins can read all events"
ON public.marketplace_events FOR SELECT
USING (public.is_admin(auth.uid()));

-- Create index for analytics queries
CREATE INDEX idx_marketplace_events_type_created ON public.marketplace_events (event_type, created_at DESC);
CREATE INDEX idx_marketplace_events_product ON public.marketplace_events (product_id, created_at DESC);
