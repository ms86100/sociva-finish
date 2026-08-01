
-- category_status_flows: most queries filter by parent_group + transaction_type + order by sort_order
CREATE INDEX IF NOT EXISTS idx_csf_group_txn_sort
  ON public.category_status_flows (parent_group, transaction_type, sort_order);

-- category_status_flows: status_key lookups (ActiveOrderStrip, OrdersMonitor)
CREATE INDEX IF NOT EXISTS idx_csf_status_key
  ON public.category_status_flows (status_key);

-- seller_profiles: cross-community search filter
CREATE INDEX IF NOT EXISTS idx_seller_profiles_verified_beyond
  ON public.seller_profiles (verification_status, sell_beyond_community)
  WHERE verification_status = 'approved' AND sell_beyond_community = true;

-- Refresh stats
ANALYZE category_status_flows, seller_profiles;
