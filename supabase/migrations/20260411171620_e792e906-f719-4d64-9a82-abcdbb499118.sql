
-- featured_items: 197 seq scans, 1.5% idx hit — banner queries filter by is_active + order by display_order
CREATE INDEX IF NOT EXISTS idx_featured_items_active_order
  ON public.featured_items (is_active, display_order) WHERE is_active = true;

-- profiles: composite index for society admin queries (pending approvals, member search)
CREATE INDEX IF NOT EXISTS idx_profiles_society_status
  ON public.profiles (society_id, verification_status);

-- Refresh planner stats
ANALYZE societies, profiles, featured_items, chat_messages, service_listings;
