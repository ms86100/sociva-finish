
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'transit_statuses',
  '"out_for_delivery,picked_up,in_transit"',
  'Comma-separated order statuses considered in-transit for stalled delivery monitoring'
)
ON CONFLICT (key) DO NOTHING;
