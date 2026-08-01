
ALTER TABLE public.featured_items
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS button_text text,
  ADD COLUMN IF NOT EXISTS bg_color text DEFAULT '#16a34a',
  ADD COLUMN IF NOT EXISTS template text DEFAULT 'image_only';
