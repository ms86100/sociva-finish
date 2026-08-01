-- Add image_url column to category_config for Blinkit-style image cards
ALTER TABLE public.category_config ADD COLUMN IF NOT EXISTS image_url text;

-- Add comment for clarity
COMMENT ON COLUMN public.category_config.image_url IS 'URL for category card image (uploaded to storage). Falls back to emoji icon if null.';
