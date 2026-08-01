-- orders: seller dashboard queries filter by seller_id + status + order by created_at
CREATE INDEX IF NOT EXISTS idx_orders_seller_status_created
  ON public.orders (seller_id, status, created_at DESC);

-- orders: seller stats query scans all orders for a seller, sorted by created_at
CREATE INDEX IF NOT EXISTS idx_orders_seller_created_desc
  ON public.orders (seller_id, created_at DESC);

-- Refresh planner stats on key seller tables
ANALYZE orders, seller_profiles, products, order_items;