CREATE INDEX IF NOT EXISTS idx_cart_items_user_product ON public.cart_items (user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created ON public.orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_created ON public.orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON public.user_notifications (user_id, is_read, created_at DESC);