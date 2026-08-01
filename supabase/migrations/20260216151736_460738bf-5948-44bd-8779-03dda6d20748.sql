
-- Performance Indexes for 10K Scale (retry without notifications)

-- Products: hot query pattern (marketplace listings)
CREATE INDEX IF NOT EXISTS idx_products_marketplace
  ON public.products (seller_id, is_available, approval_status)
  WHERE is_available = true AND approval_status = 'approved';

-- Products: category filtering
CREATE INDEX IF NOT EXISTS idx_products_category_available
  ON public.products (category, is_available, approval_status)
  WHERE is_available = true AND approval_status = 'approved';

-- Products: bestseller sorting
CREATE INDEX IF NOT EXISTS idx_products_bestseller_updated
  ON public.products (is_bestseller DESC, updated_at DESC)
  WHERE is_available = true AND approval_status = 'approved';

-- Seller profiles: society-scoped approved sellers
CREATE INDEX IF NOT EXISTS idx_seller_profiles_society_approved
  ON public.seller_profiles (society_id, verification_status, is_available)
  WHERE verification_status = 'approved';

-- Seller profiles: cross-society discovery
CREATE INDEX IF NOT EXISTS idx_seller_profiles_cross_society
  ON public.seller_profiles (verification_status, sell_beyond_community, delivery_radius_km)
  WHERE verification_status = 'approved' AND sell_beyond_community = true;

-- Seller profiles: featured + rating sort
CREATE INDEX IF NOT EXISTS idx_seller_profiles_featured_rating
  ON public.seller_profiles (society_id, is_featured DESC, rating DESC)
  WHERE verification_status = 'approved';

-- Orders: seller dashboard queries
CREATE INDEX IF NOT EXISTS idx_orders_seller_status
  ON public.orders (seller_id, status, created_at DESC);

-- Orders: buyer order history
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
  ON public.orders (buyer_id, created_at DESC);

-- Cart items: user cart lookup
CREATE INDEX IF NOT EXISTS idx_cart_items_user
  ON public.cart_items (user_id, product_id);

-- Reviews: seller reviews
CREATE INDEX IF NOT EXISTS idx_reviews_seller_visible
  ON public.reviews (seller_id, is_hidden)
  WHERE is_hidden = false;

-- Bulletin posts: society feed
CREATE INDEX IF NOT EXISTS idx_bulletin_posts_society_recent
  ON public.bulletin_posts (society_id, is_archived, created_at DESC)
  WHERE is_archived = false;

-- Gate entries: society + recent
CREATE INDEX IF NOT EXISTS idx_gate_entries_society_recent
  ON public.gate_entries (society_id, entry_time DESC);

-- Favorites: user lookups
CREATE INDEX IF NOT EXISTS idx_favorites_user
  ON public.favorites (user_id, seller_id);

-- Category config: active categories ordered
CREATE INDEX IF NOT EXISTS idx_category_config_active
  ON public.category_config (is_active, display_order)
  WHERE is_active = true;
