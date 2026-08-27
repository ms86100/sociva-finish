-- orders.scheduled_fulfilment_at used British spelling (fulfilment).
-- seller_advance_order references American spelling scheduled_fulfillment_at,
-- which broke seller accept-order with: column o.scheduled_fulfillment_at does not exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'orders'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname = 'scheduled_fulfilment_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'orders'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname = 'scheduled_fulfillment_at'
  ) THEN
    ALTER TABLE public.orders
      RENAME COLUMN scheduled_fulfilment_at TO scheduled_fulfillment_at;
  END IF;
END $$;
