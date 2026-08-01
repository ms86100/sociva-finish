
-- Add unique constraint on status_key that was missing
ALTER TABLE public.order_status_config ADD CONSTRAINT order_status_config_status_key_key UNIQUE (status_key);

-- Seed payment_pending status
INSERT INTO public.order_status_config (status_key, label, color, sort_order)
VALUES ('payment_pending', 'Awaiting Payment', 'bg-yellow-100 text-yellow-800', 0)
ON CONFLICT (status_key) DO NOTHING;
