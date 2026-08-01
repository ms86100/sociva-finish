
-- Batch insert ~50 system_settings keys for marketplace labels, thresholds, and JSON enums
-- Using ON CONFLICT to avoid duplicates if any already exist

INSERT INTO public.system_settings (key, value) VALUES
  -- Trust Signal Labels
  ('label_in_your_society', 'In your society'),
  ('label_distance_m_format', '{distance}m away'),
  ('label_distance_km_format', '{distance} km away'),
  ('label_your_neighbor', 'Your neighbor'),
  ('label_active_now', 'Active now'),
  ('label_active_hours_ago', '{hours}h ago'),
  ('label_active_yesterday', 'Yesterday'),
  ('label_on_time_format', '✓ On-time: {pct}%'),
  ('label_social_proof_format', '👥 {count} {unit} ordered this week'),
  ('label_social_proof_singular', 'family'),
  ('label_social_proof_plural', 'families'),
  ('label_stable_price', 'Stable Price (30+ days)'),
  -- Notify Me Labels
  ('label_notify_me', 'Notify Me'),
  ('label_notify_watching', 'Watching'),
  ('label_notify_watching_long', 'Watching — We''ll notify you'),
  ('label_notify_me_long', 'Notify Me When Available'),
  -- Checkout Trust Labels
  ('label_checkout_community_support', 'This order supports {count} local business{suffix} in your community'),
  ('label_checkout_community_emoji', '💚'),
  ('label_neighborhood_guarantee', 'Neighborhood Guarantee'),
  ('label_neighborhood_guarantee_desc', 'Your society committee will review this as a neutral party'),
  ('label_neighborhood_guarantee_badge', 'Protected by Neighborhood Guarantee — disputes resolved by your society committee'),
  ('label_neighborhood_guarantee_emoji', '🛡️'),
  ('label_dispute_sla_notice', 'The committee will review within 48 hours.'),
  -- Group Buy Labels
  ('label_group_buy_title', 'Community Group Buys'),
  ('label_group_buy_subtitle', 'Pool orders with neighbors for better deals'),
  ('label_group_buy_empty', 'No active group buys'),
  ('label_group_buy_empty_desc', 'Group buys from your community will appear here'),
  ('label_group_buy_join', 'Join Group Buy'),
  ('label_group_buy_leave', 'Leave Group Buy'),
  ('label_group_buy_fulfilled', '✓ Target Reached'),
  -- Seller Intelligence Labels
  ('label_demand_insights_title', 'What buyers are searching for'),
  ('label_demand_insights_empty', 'No seller in your society offers these items yet — opportunity!'),
  ('label_reputation_empty', 'No reputation history yet'),
  ('label_reputation_empty_desc', 'Events will appear as orders are completed'),
  -- Discovery Labels
  ('label_discovery_popular', 'Popular near you'),
  ('label_discovery_new', 'New this week'),
  -- Reorder Labels
  ('label_reorder_prefix', 'Reorder from'),
  ('label_reorder_success', 'Cart rebuilt! Review and checkout.'),
  ('label_reorder_unavailable', 'Items from this order are no longer available'),
  -- Business Logic Thresholds
  ('on_time_badge_min_orders', '5'),
  ('stable_price_days', '30'),
  ('new_this_week_days', '7'),
  ('discovery_min_products', '3'),
  ('discovery_max_items', '10'),
  ('price_history_max_points', '30'),
  ('demand_insights_max_items', '5'),
  ('dispute_sla_warning_hours', '48'),
  -- Seller Analytics Labels
  ('label_analytics_intelligence_title', '30-Day Intelligence'),
  ('label_analytics_active_buyers', 'Active Buyers'),
  ('label_analytics_views', 'Views'),
  ('label_analytics_conversion', 'Conversion'),
  ('label_analytics_fee_format', '{pct}% platform fee'),
  ('label_analytics_fee_desc', 'Applied on each completed order'),
  -- JSON Enums
  ('dispute_categories_json', '[{"value":"noise","label":"Noise"},{"value":"parking","label":"Parking"},{"value":"pet","label":"Pet Related"},{"value":"maintenance","label":"Maintenance"},{"value":"other","label":"Other"}]'),
  ('reputation_event_labels_json', '{"order_completed":{"label":"Order Completed","color":"text-success"},"order_cancelled":{"label":"Order Cancelled","color":"text-destructive"},"dispute_resolved":{"label":"Dispute Resolved","color":"text-success"},"dispute_lost":{"label":"Dispute Lost","color":"text-destructive"},"response_fast":{"label":"Fast Response","color":"text-primary"},"response_slow":{"label":"Slow Response","color":"text-warning"}}'),
  ('dispute_status_options_json', '[{"value":"acknowledged","label":"Acknowledge"},{"value":"under_review","label":"Under Review"},{"value":"resolved","label":"Resolved"},{"value":"escalated","label":"Escalated"},{"value":"closed","label":"Close"}]')
ON CONFLICT (key) DO NOTHING;
