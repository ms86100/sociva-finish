
INSERT INTO public.system_settings (key, value, description) VALUES
  -- GPS filter parameters
  ('gps_max_speed_kmh', '120', 'Maximum plausible speed in km/h for GPS teleport rejection'),
  ('gps_smoothing_factor', '0.7', 'Exponential smoothing weight for new GPS points (0-1)'),
  ('gps_min_movement_meters', '1', 'Minimum movement in meters to accept a GPS update'),
  -- Location broadcasting intervals
  ('location_interval_moving_ms', '5000', 'GPS send interval in ms when rider is moving'),
  ('location_interval_idle_ms', '15000', 'GPS send interval in ms when rider is idle'),
  ('location_speed_threshold_kmh', '5', 'Speed threshold to switch between moving/idle intervals'),
  ('location_max_queued_points', '20', 'Max queued location points when offline'),
  -- Staleness and stalled thresholds
  ('location_stale_threshold_ms', '120000', 'Time in ms after which location is considered stale (2 min)'),
  ('stalled_soft_threshold_minutes', '10', 'Minutes of no GPS before soft stall alert'),
  ('stalled_hard_threshold_minutes', '30', 'Minutes of no GPS before hard stall alert'),
  -- OSRM and map parameters
  ('osrm_refetch_threshold_meters', '80', 'Rider must move this many meters before re-fetching OSRM route'),
  ('osrm_timeout_ms', '5000', 'OSRM route fetch timeout in ms'),
  ('map_animation_duration_ms', '2000', 'Duration of rider marker animation in ms'),
  ('max_delivery_distance_km', '10', 'Max distance in km for progress interpolation heuristic'),
  -- Transit status list (JSON array)
  ('transit_statuses', '["picked_up","on_the_way","at_gate"]', 'Statuses considered in-transit for delivery tracking'),
  ('transit_statuses_la', '["en_route","on_the_way","picked_up"]', 'Statuses considered in-transit for Live Activity progress stage'),
  -- Arrival overlay thresholds
  ('arrival_overlay_distance_meters', '200', 'Distance threshold in meters to show arrival overlay'),
  ('arrival_doorstep_distance_meters', '50', 'Distance threshold in meters for at-doorstep state'),
  -- Delivery status card labels (JSON map)
  ('delivery_status_labels', '{"pending":{"label":"Assigning Rider","buyer_msg":"Finding a delivery partner for your order...","seller_msg":"Assigning a delivery partner..."},"assigned":{"label":"Rider Assigned","buyer_msg":"will pick up your order soon.","seller_msg":"assigned, will pick up soon."},"picked_up":{"label":"Out for Delivery","buyer_msg":"Your order is on the way!","seller_msg":"Rider has picked up the order."},"on_the_way":{"label":"On The Way","buyer_msg":"Your order is on the way!","seller_msg":"Rider is en route to the buyer."},"at_gate":{"label":"At Your Gate","buyer_msg":"Delivery partner is at your society gate.","seller_msg":"Rider is at the buyer''s gate."},"delivered":{"label":"Delivered","buyer_msg":"Your order has been delivered!","seller_msg":"Delivery completed successfully."},"failed":{"label":"Delivery Failed","buyer_msg":"","seller_msg":"Delivery failed. Check reason above."},"cancelled":{"label":"Cancelled","buyer_msg":"","seller_msg":""}}', 'Delivery status card labels and messages per status'),
  -- UI strings
  ('ui_live_tracking_title', 'Live Tracking', 'Title for the live tracking card'),
  ('ui_delivery_partner_label', 'Delivery Partner', 'Label for delivery partner in tracking UI'),
  ('ui_location_stale_warning', 'Location may be outdated — GPS is not updating', 'Warning message when GPS location is stale'),
  ('ui_setting_up_tracking', 'Setting up live tracking...', 'Message shown while delivery assignment is being created'),
  ('ui_gps_broadcasting_title', 'GPS Broadcasting', 'Title for seller GPS broadcasting card'),
  ('ui_gps_keep_open_warning', 'Keep this screen open while delivering. Browser backgrounding can pause GPS updates.', 'Warning for web-based GPS broadcasting'),
  ('ui_gps_permission_denied', 'Location permission denied. Enable it in device settings to share your location with the buyer.', 'GPS permission denied message'),
  ('ui_start_sharing_location', 'Start Sharing Location', 'Button text to start GPS sharing'),
  ('ui_sharing_location', 'Sharing your location with buyer', 'Status message when GPS is being shared'),
  ('ui_stop_sharing', 'Stop Sharing', 'Button text to stop GPS sharing')
ON CONFLICT (key) DO NOTHING;
