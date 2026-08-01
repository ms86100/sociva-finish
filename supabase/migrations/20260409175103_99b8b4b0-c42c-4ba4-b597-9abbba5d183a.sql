
-- 1. banner_theme_presets
CREATE TABLE IF NOT EXISTS public.banner_theme_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    preset_key text NOT NULL,
    label text NOT NULL,
    icon_emoji text,
    colors jsonb DEFAULT '{}'::jsonb NOT NULL,
    animation_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    suggested_sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.banner_theme_presets ADD CONSTRAINT banner_theme_presets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banner_theme_presets ADD CONSTRAINT banner_theme_presets_preset_key_key UNIQUE (preset_key);
ALTER TABLE public.banner_theme_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage theme presets" ON public.banner_theme_presets TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.user_role));
CREATE POLICY "Anyone can read theme presets" ON public.banner_theme_presets FOR SELECT USING (true);

-- 2. banner_sections
CREATE TABLE IF NOT EXISTS public.banner_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    banner_id uuid NOT NULL,
    title text NOT NULL,
    subtitle text,
    icon_emoji text,
    display_order integer DEFAULT 0 NOT NULL,
    product_source_type text DEFAULT 'category'::text NOT NULL,
    product_source_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT banner_sections_product_source_type_check CHECK ((product_source_type = ANY (ARRAY['category'::text, 'search'::text, 'manual'::text])))
);
ALTER TABLE ONLY public.banner_sections ADD CONSTRAINT banner_sections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banner_sections ADD CONSTRAINT banner_sections_banner_id_fkey FOREIGN KEY (banner_id) REFERENCES public.featured_items(id) ON DELETE CASCADE;
ALTER TABLE public.banner_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage banner sections" ON public.banner_sections TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.user_role));
CREATE POLICY "Anyone can read banner sections" ON public.banner_sections FOR SELECT USING (true);
CREATE INDEX idx_banner_sections_banner ON public.banner_sections USING btree (banner_id);

-- 3. banner_section_products
CREATE TABLE IF NOT EXISTS public.banner_section_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    section_id uuid NOT NULL,
    product_id uuid NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);
ALTER TABLE ONLY public.banner_section_products ADD CONSTRAINT banner_section_products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banner_section_products ADD CONSTRAINT banner_section_products_section_id_product_id_key UNIQUE (section_id, product_id);
ALTER TABLE ONLY public.banner_section_products ADD CONSTRAINT banner_section_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.banner_section_products ADD CONSTRAINT banner_section_products_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.banner_sections(id) ON DELETE CASCADE;
ALTER TABLE public.banner_section_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage banner section products" ON public.banner_section_products TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.user_role));
CREATE POLICY "Anyone can read banner section products" ON public.banner_section_products FOR SELECT USING (true);

-- 4. banner_analytics
CREATE TABLE IF NOT EXISTS public.banner_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    banner_id uuid NOT NULL,
    section_id uuid,
    event_type text NOT NULL,
    product_id uuid,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT banner_analytics_event_type_check CHECK ((event_type = ANY (ARRAY['impression'::text, 'section_click'::text, 'product_click'::text])))
);
ALTER TABLE ONLY public.banner_analytics ADD CONSTRAINT banner_analytics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banner_analytics ADD CONSTRAINT banner_analytics_banner_id_fkey FOREIGN KEY (banner_id) REFERENCES public.featured_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.banner_analytics ADD CONSTRAINT banner_analytics_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.banner_sections(id) ON DELETE SET NULL;
ALTER TABLE public.banner_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read analytics" ON public.banner_analytics FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.user_role));
CREATE POLICY "Authenticated users can log analytics" ON public.banner_analytics FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX idx_banner_analytics_lookup ON public.banner_analytics USING btree (banner_id, event_type, created_at);

-- 5. product_views
CREATE TABLE IF NOT EXISTS public.product_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    viewer_id uuid,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.product_views ADD CONSTRAINT product_views_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.product_views ADD CONSTRAINT product_views_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.product_views ADD CONSTRAINT product_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can insert product views" ON public.product_views FOR INSERT TO authenticated WITH CHECK ((auth.uid() = viewer_id));
CREATE POLICY "Sellers can view their product views" ON public.product_views FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM public.products p JOIN public.seller_profiles sp ON sp.id = p.seller_id WHERE p.id = product_views.product_id AND sp.user_id = auth.uid())));

-- 6. society_aliases
CREATE TABLE IF NOT EXISTS public.society_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    society_id uuid NOT NULL,
    alias_name text NOT NULL,
    normalized_alias text NOT NULL,
    google_place_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.society_aliases ADD CONSTRAINT society_aliases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.society_aliases ADD CONSTRAINT society_aliases_normalized_alias_key UNIQUE (normalized_alias);
ALTER TABLE ONLY public.society_aliases ADD CONSTRAINT society_aliases_society_id_fkey FOREIGN KEY (society_id) REFERENCES public.societies(id) ON DELETE CASCADE;
ALTER TABLE public.society_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read aliases" ON public.society_aliases FOR SELECT USING (true);
CREATE INDEX idx_aliases_society ON public.society_aliases USING btree (society_id);
CREATE INDEX idx_aliases_trgm ON public.society_aliases USING gin (normalized_alias public.gin_trgm_ops);
