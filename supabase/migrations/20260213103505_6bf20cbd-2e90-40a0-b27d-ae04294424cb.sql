
-- Create societies table
CREATE TABLE public.societies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  address text,
  city text,
  state text,
  pincode text,
  latitude numeric,
  longitude numeric,
  geofence_radius_meters integer DEFAULT 500,
  is_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  admin_user_id uuid REFERENCES public.profiles(id),
  member_count integer DEFAULT 0,
  logo_url text,
  rules_text text,
  invite_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.societies ENABLE ROW LEVEL SECURITY;

-- Anyone can view active verified societies
CREATE POLICY "Anyone can view active societies"
ON public.societies
FOR SELECT
USING (is_active = true OR is_admin(auth.uid()));

-- Only admins can manage societies
CREATE POLICY "Admins can manage societies"
ON public.societies
FOR ALL
USING (is_admin(auth.uid()));

-- Authenticated users can request new societies (insert)
CREATE POLICY "Users can request societies"
ON public.societies
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Add society_id to profiles
ALTER TABLE public.profiles ADD COLUMN society_id uuid REFERENCES public.societies(id);

-- Add society_id to seller_profiles
ALTER TABLE public.seller_profiles ADD COLUMN society_id uuid REFERENCES public.societies(id);

-- Insert default "Shriram Greenfield" society
INSERT INTO public.societies (id, name, slug, address, city, state, pincode, is_verified, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Shriram Greenfield',
  'shriram-greenfield',
  'Shriram Greenfield, Budigere Cross',
  'Bangalore',
  'Karnataka',
  '560049',
  true,
  true
);

-- Migrate all existing profiles to default society
UPDATE public.profiles SET society_id = 'a0000000-0000-0000-0000-000000000001';

-- Migrate all existing seller_profiles to default society
UPDATE public.seller_profiles SET society_id = 'a0000000-0000-0000-0000-000000000001';

-- Create index for faster lookups
CREATE INDEX idx_profiles_society_id ON public.profiles(society_id);
CREATE INDEX idx_seller_profiles_society_id ON public.seller_profiles(society_id);
CREATE INDEX idx_societies_slug ON public.societies(slug);
CREATE INDEX idx_societies_pincode ON public.societies(pincode);

-- Update timestamp trigger for societies
CREATE TRIGGER update_societies_updated_at
BEFORE UPDATE ON public.societies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();
