-- Add columns for reporting products and posts
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reported_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reported_post_id uuid REFERENCES public.bulletin_posts(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reports_product_id ON public.reports(reported_product_id) WHERE reported_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_post_id ON public.reports(reported_post_id) WHERE reported_post_id IS NOT NULL;