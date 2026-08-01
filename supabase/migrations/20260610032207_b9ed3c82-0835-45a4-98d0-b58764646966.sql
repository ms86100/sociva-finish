
UPDATE public.notification_templates SET body_template =
  'You have a new order ({{item_summary}}). Please accept to start preparing.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_placed_seller_l1';

UPDATE public.notification_templates SET body_template =
  'Buyer is waiting. Please accept the order now. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_placed_seller_l2';

UPDATE public.notification_templates SET body_template =
  'Accept now or this order will be auto-cancelled soon. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_placed_seller_l3';

UPDATE public.notification_templates SET body_template =
  'Accept immediately or the order will be auto-cancelled. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_placed_seller_l4';

UPDATE public.notification_templates SET body_template =
  'Buyer is waiting for you to begin preparation. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_accepted_no_progress_l1';

UPDATE public.notification_templates SET body_template =
  'Please update the order status. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_accepted_no_progress_l2';

UPDATE public.notification_templates SET body_template =
  'Please mark as ready when done. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_preparing_slow_l1';

UPDATE public.notification_templates SET body_template =
  'Please hand over or dispatch the order. Items: {{item_summary}}.',
  variables = '["order_short","item_summary","item_count"]'::jsonb
WHERE key = 'order_ready_pickup_l1';
