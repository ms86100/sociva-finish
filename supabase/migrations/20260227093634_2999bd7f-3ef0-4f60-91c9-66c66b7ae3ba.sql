-- Ensure realtime UPDATE payloads include previous row values for buyer order alert diffing
ALTER TABLE public.orders REPLICA IDENTITY FULL;