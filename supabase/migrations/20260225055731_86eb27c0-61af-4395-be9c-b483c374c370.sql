-- D5: notification_preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  orders boolean NOT NULL DEFAULT true,
  chat boolean NOT NULL DEFAULT true,
  promotions boolean NOT NULL DEFAULT true,
  sounds boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification preferences" ON public.notification_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification preferences" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification preferences" ON public.notification_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- E1: Add country code to system_settings
INSERT INTO public.system_settings (key, value, description)
VALUES 
  ('default_country_code', '+91', 'Default phone country code'),
  ('supported_country_codes', '+91,+1,+44,+971,+65,+61', 'Comma-separated supported country codes')
ON CONFLICT (key) DO NOTHING;

-- Clean up duplicate function signature if exists
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid,text,text,text,text,uuid,text,numeric,numeric,boolean,jsonb);