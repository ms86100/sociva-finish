
CREATE TABLE public.delivery_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid REFERENCES public.societies(id),
  label text NOT NULL DEFAULT 'Home',
  flat_number text NOT NULL DEFAULT '',
  block text DEFAULT '',
  floor text DEFAULT '',
  building_name text DEFAULT '',
  landmark text DEFAULT '',
  full_address text DEFAULT '',
  latitude double precision,
  longitude double precision,
  pincode text DEFAULT '',
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.delivery_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own addresses" ON public.delivery_addresses
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_delivery_addresses_user ON public.delivery_addresses (user_id);

CREATE TRIGGER update_delivery_addresses_updated_at
  BEFORE UPDATE ON public.delivery_addresses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
