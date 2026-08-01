ALTER TABLE public.category_status_flows
  ADD COLUMN IF NOT EXISTS buyer_display_label text,
  ADD COLUMN IF NOT EXISTS seller_display_label text;