
-- ═══════════════════════════════════════════════════
-- Festival Experience Engine — Schema Migration
-- ═══════════════════════════════════════════════════

-- 1. Extend featured_items with new columns
ALTER TABLE public.featured_items
  ADD COLUMN IF NOT EXISTS banner_type text NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS theme_preset text,
  ADD COLUMN IF NOT EXISTS theme_config jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS animation_config jsonb NOT NULL DEFAULT '{"type":"none","intensity":"subtle"}',
  ADD COLUMN IF NOT EXISTS cta_config jsonb NOT NULL DEFAULT '{"action":"link"}',
  ADD COLUMN IF NOT EXISTS schedule_start timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_end timestamptz,
  ADD COLUMN IF NOT EXISTS badge_text text,
  ADD COLUMN IF NOT EXISTS fallback_mode text NOT NULL DEFAULT 'hide';

-- 2. Banner sections table
CREATE TABLE public.banner_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id uuid NOT NULL REFERENCES public.featured_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  subtitle text,
  icon_emoji text,
  display_order int NOT NULL DEFAULT 0,
  product_source_type text NOT NULL DEFAULT 'category'
    CHECK (product_source_type IN ('category','search','manual')),
  product_source_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_banner_sections_banner ON public.banner_sections(banner_id);

-- 3. Banner section products (manual linking)
CREATE TABLE public.banner_section_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.banner_sections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  display_order int NOT NULL DEFAULT 0,
  UNIQUE(section_id, product_id)
);

-- 4. Banner theme presets (reference data)
CREATE TABLE public.banner_theme_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_key text UNIQUE NOT NULL,
  label text NOT NULL,
  icon_emoji text,
  colors jsonb NOT NULL DEFAULT '{}',
  animation_defaults jsonb NOT NULL DEFAULT '{}',
  suggested_sections jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Banner analytics (lightweight event log)
CREATE TABLE public.banner_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id uuid NOT NULL REFERENCES public.featured_items(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.banner_sections(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','section_click','product_click')),
  product_id uuid,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_banner_analytics_lookup ON public.banner_analytics(banner_id, event_type, created_at);

-- 6. RLS policies

-- banner_sections: public read, admin write
ALTER TABLE public.banner_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read banner sections"
  ON public.banner_sections FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage banner sections"
  ON public.banner_sections FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- banner_section_products: public read, admin write
ALTER TABLE public.banner_section_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read banner section products"
  ON public.banner_section_products FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage banner section products"
  ON public.banner_section_products FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- banner_theme_presets: public read, admin write
ALTER TABLE public.banner_theme_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read theme presets"
  ON public.banner_theme_presets FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage theme presets"
  ON public.banner_theme_presets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- banner_analytics: authenticated insert, admin read
ALTER TABLE public.banner_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can log analytics"
  ON public.banner_analytics FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read analytics"
  ON public.banner_analytics FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7. Enable realtime for banner_sections
ALTER PUBLICATION supabase_realtime ADD TABLE public.banner_sections;
