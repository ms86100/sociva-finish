ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_booking_idempotency 
  ON public.orders (buyer_id, idempotency_key) 
  WHERE idempotency_key IS NOT NULL AND order_type = 'booking';