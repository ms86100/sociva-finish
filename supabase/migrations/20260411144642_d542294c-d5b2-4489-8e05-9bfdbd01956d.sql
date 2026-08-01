
-- 1. Festival seller participation table
CREATE TABLE public.festival_seller_participation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  banner_id UUID NOT NULL REFERENCES public.featured_items(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  opted_in BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(banner_id, seller_id)
);

ALTER TABLE public.festival_seller_participation ENABLE ROW LEVEL SECURITY;

-- Sellers can view their own participation
CREATE POLICY "seller_read_own_participation"
  ON public.festival_seller_participation FOR SELECT TO authenticated
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

-- Sellers can insert their own participation
CREATE POLICY "seller_insert_own_participation"
  ON public.festival_seller_participation FOR INSERT TO authenticated
  WITH CHECK (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

-- Sellers can update their own participation
CREATE POLICY "seller_update_own_participation"
  ON public.festival_seller_participation FOR UPDATE TO authenticated
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

-- 2. Seed theme presets
INSERT INTO public.banner_theme_presets (preset_key, label, icon_emoji, colors, animation_defaults, suggested_sections, is_active)
VALUES
  ('diwali', 'Diwali', '🪔', '{"bg":"#1a0a2e","gradient":["#ff6b00","#ffd700","#ff8c00"],"accent":"#ffd700","text":"#ffffff"}', '{"type":"sparkle","intensity":"high","particleColor":"#ffd700"}', '[{"title":"Diyas & Candles","icon_emoji":"🪔","product_source_type":"category","product_source_value":"diyas"},{"title":"Sweets & Mithai","icon_emoji":"🍬","product_source_type":"category","product_source_value":"sweets"},{"title":"Decorations","icon_emoji":"✨","product_source_type":"category","product_source_value":"decorations"},{"title":"Gift Hampers","icon_emoji":"🎁","product_source_type":"category","product_source_value":"gifts"}]', true),
  ('holi', 'Holi', '🎨', '{"bg":"#1a0533","gradient":["#ff006e","#8338ec","#3a86ff","#06d6a0"],"accent":"#ff006e","text":"#ffffff"}', '{"type":"confetti","intensity":"high","particleColor":"#ff006e"}', '[{"title":"Colors & Gulal","icon_emoji":"🎨","product_source_type":"category","product_source_value":"colors"},{"title":"Water Guns","icon_emoji":"🔫","product_source_type":"category","product_source_value":"toys"},{"title":"Sweets","icon_emoji":"🍡","product_source_type":"category","product_source_value":"sweets"},{"title":"Skincare","icon_emoji":"🧴","product_source_type":"category","product_source_value":"skincare"}]', true),
  ('christmas', 'Christmas', '🎄', '{"bg":"#0d1b0e","gradient":["#c41e3a","#2d5a27","#c41e3a"],"accent":"#c41e3a","text":"#ffffff"}', '{"type":"shimmer","intensity":"medium","particleColor":"#ffffff"}', '[{"title":"Decorations","icon_emoji":"🎄","product_source_type":"category","product_source_value":"decorations"},{"title":"Gifts","icon_emoji":"🎁","product_source_type":"category","product_source_value":"gifts"},{"title":"Cakes & Treats","icon_emoji":"🎂","product_source_type":"category","product_source_value":"cakes"},{"title":"Party Supplies","icon_emoji":"🎉","product_source_type":"category","product_source_value":"party"}]', true),
  ('eid', 'Eid', '🌙', '{"bg":"#0a1628","gradient":["#006d5b","#c5a030","#006d5b"],"accent":"#c5a030","text":"#ffffff"}', '{"type":"glow","intensity":"medium","particleColor":"#c5a030"}', '[{"title":"Sweets & Desserts","icon_emoji":"🍮","product_source_type":"category","product_source_value":"sweets"},{"title":"Attire","icon_emoji":"👔","product_source_type":"category","product_source_value":"clothing"},{"title":"Gifts","icon_emoji":"🎁","product_source_type":"category","product_source_value":"gifts"},{"title":"Decorations","icon_emoji":"🌙","product_source_type":"category","product_source_value":"decorations"}]', true),
  ('ugadi', 'Ugadi', '🌿', '{"bg":"#1a2e0a","gradient":["#7cb342","#fdd835","#7cb342"],"accent":"#fdd835","text":"#ffffff"}', '{"type":"pulse","intensity":"low","particleColor":"#7cb342"}', '[{"title":"Puja Items","icon_emoji":"🙏","product_source_type":"category","product_source_value":"puja"},{"title":"Sweets","icon_emoji":"🍬","product_source_type":"category","product_source_value":"sweets"},{"title":"Mango Products","icon_emoji":"🥭","product_source_type":"category","product_source_value":"fruits"},{"title":"Decorations","icon_emoji":"🌿","product_source_type":"category","product_source_value":"decorations"}]', true),
  ('sale', 'Generic Sale', '🏷️', '{"bg":"#1a1a2e","gradient":["#e63946","#457b9d","#e63946"],"accent":"#e63946","text":"#ffffff"}', '{"type":"none","intensity":"low","particleColor":"#e63946"}', '[{"title":"Best Deals","icon_emoji":"🔥","product_source_type":"category","product_source_value":"deals"},{"title":"Top Picks","icon_emoji":"⭐","product_source_type":"category","product_source_value":"featured"}]', true)
ON CONFLICT DO NOTHING;
