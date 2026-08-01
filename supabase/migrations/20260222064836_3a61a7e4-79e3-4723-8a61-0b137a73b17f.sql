
ALTER TABLE public.profiles
  ALTER COLUMN browse_beyond_community SET DEFAULT true;
ALTER TABLE public.profiles
  ALTER COLUMN search_radius_km SET DEFAULT 10;

-- Update existing users who still have old defaults
UPDATE public.profiles
  SET browse_beyond_community = true
  WHERE browse_beyond_community = false;
UPDATE public.profiles
  SET search_radius_km = 10
  WHERE search_radius_km = 5;
