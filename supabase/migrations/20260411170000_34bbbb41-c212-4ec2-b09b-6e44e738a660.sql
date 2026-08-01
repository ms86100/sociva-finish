CREATE INDEX IF NOT EXISTS idx_products_seller_sort
  ON public.products (seller_id, is_available, approval_status, is_bestseller DESC NULLS LAST, is_recommended DESC NULLS LAST, name);

CREATE INDEX IF NOT EXISTS idx_delivery_addresses_user_default
  ON public.delivery_addresses (user_id, is_default DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_order
  ON public.payment_records (order_id);

CREATE INDEX IF NOT EXISTS idx_csf_terminal
  ON public.category_status_flows (is_terminal, is_success) WHERE is_terminal = true;

CREATE INDEX IF NOT EXISTS idx_reviews_seller
  ON public.reviews (seller_id);

CREATE INDEX IF NOT EXISTS idx_featured_items_type_active
  ON public.featured_items (type, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_schedules_product
  ON public.service_availability_schedules (product_id);