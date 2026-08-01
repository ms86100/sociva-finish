CREATE INDEX IF NOT EXISTS idx_products_seller_avail 
ON public.products(seller_id, is_available, approval_status);