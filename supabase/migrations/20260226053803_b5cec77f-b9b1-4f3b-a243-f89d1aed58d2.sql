
-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Add seller_profiles to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_profiles;
