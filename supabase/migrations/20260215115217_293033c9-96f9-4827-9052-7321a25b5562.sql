
-- ============================================================
-- Phase 1: Make all static elements DB-configurable
-- ============================================================

-- 1. Extend category_config with display control columns
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS supports_brand_display boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_warranty_display boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_aspect_ratio text NOT NULL DEFAULT 'square',
  ADD COLUMN IF NOT EXISTS image_object_fit text NOT NULL DEFAULT 'cover';

-- Set sensible defaults for existing categories based on current hardcoded logic
UPDATE public.category_config SET supports_brand_display = true WHERE layout_type = 'ecommerce';
UPDATE public.category_config SET supports_warranty_display = true WHERE layout_type = 'service';
UPDATE public.category_config SET image_aspect_ratio = '4:3', image_object_fit = 'cover' WHERE layout_type = 'food';
UPDATE public.category_config SET image_aspect_ratio = '16:10', image_object_fit = 'cover' WHERE layout_type = 'service';
UPDATE public.category_config SET image_aspect_ratio = 'square', image_object_fit = 'contain' WHERE layout_type = 'ecommerce';

-- 2. Insert all UI label keys into system_settings
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('label_out_of_stock', 'Out of stock', 'Label shown on out-of-stock overlay'),
  ('label_sold_out', 'Sold out', 'Button label when product is sold out'),
  ('label_unavailable', 'Unavailable', 'Label for unavailable non-cart products'),
  ('label_contact_for_price', 'Contact for price', 'Price area label for contact_seller action'),
  ('label_discount_suffix', '% OFF', 'Suffix after discount percentage'),
  ('label_min_charge_prefix', 'Min', 'Prefix before minimum charge amount'),
  ('label_visit_prefix', 'Visit:', 'Prefix before visit charge amount'),
  ('label_orders_suffix', 'orders', 'Suffix after order count'),
  ('label_view_button', 'View', 'Label for view-only button'),
  ('label_fallback_seller', 'Seller', 'Default seller name when none provided'),
  ('label_duration_suffix', 'min', 'Suffix for duration in minutes'),
  ('label_prep_time_format', '~{value}m', 'Format for prep time display'),
  ('default_placeholder_emoji', '🛒', 'Default emoji when category has no placeholder'),
  ('default_button_label', 'ADD', 'Default action button label'),
  ('spice_emoji_map', '{"mild":"🌶️","medium":"🌶️🌶️","hot":"🌶️🌶️🌶️","extra_hot":"🔥"}', 'Spice level to emoji mapping')
ON CONFLICT (key) DO NOTHING;

-- 3. Create order_status_config table (replaces EXTENDED_ORDER_STATUS_LABELS)
CREATE TABLE IF NOT EXISTS public.order_status_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status_key text NOT NULL UNIQUE,
  label text NOT NULL,
  color text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_status_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_status_config readable by all authenticated"
  ON public.order_status_config FOR SELECT
  TO authenticated
  USING (true);

-- Seed with current hardcoded values
INSERT INTO public.order_status_config (status_key, label, color, sort_order) VALUES
  ('placed', 'Order Placed', 'bg-blue-100 text-blue-800', 1),
  ('accepted', 'Accepted', 'bg-indigo-100 text-indigo-800', 2),
  ('preparing', 'Preparing', 'bg-yellow-100 text-yellow-800', 3),
  ('ready', 'Ready', 'bg-green-100 text-green-800', 4),
  ('picked_up', 'Picked Up', 'bg-teal-100 text-teal-800', 5),
  ('delivered', 'Delivered', 'bg-emerald-100 text-emerald-800', 6),
  ('completed', 'Completed', 'bg-gray-100 text-gray-800', 7),
  ('cancelled', 'Cancelled', 'bg-red-100 text-red-800', 8),
  ('enquired', 'Enquiry Sent', 'bg-purple-100 text-purple-800', 9),
  ('quoted', 'Quote Received', 'bg-orange-100 text-orange-800', 10),
  ('scheduled', 'Scheduled', 'bg-cyan-100 text-cyan-800', 11),
  ('in_progress', 'In Progress', 'bg-amber-100 text-amber-800', 12),
  ('returned', 'Returned', 'bg-slate-100 text-slate-800', 13)
ON CONFLICT (status_key) DO NOTHING;

-- 4. Create item_condition_config (replaces ITEM_CONDITION_LABELS)
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('item_condition_labels', '{"new":{"label":"Brand New","color":"bg-green-100 text-green-800"},"like_new":{"label":"Like New","color":"bg-teal-100 text-teal-800"},"good":{"label":"Good","color":"bg-blue-100 text-blue-800"},"fair":{"label":"Fair","color":"bg-yellow-100 text-yellow-800"}}', 'Item condition label and color config'),
  ('rental_period_labels', '{"hourly":"per hour","daily":"per day","weekly":"per week","monthly":"per month"}', 'Rental period display labels')
ON CONFLICT (key) DO NOTHING;
