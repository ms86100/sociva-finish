-- New profiles must browse beyond community by default.
-- handle_new_user omits the column, so the table default is the source of truth.

ALTER TABLE public.profiles
  ALTER COLUMN browse_beyond_community SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.profiles_force_browse_beyond_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.browse_beyond_community := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_browse_beyond_on_insert ON public.profiles;
CREATE TRIGGER trg_profiles_browse_beyond_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_force_browse_beyond_on_insert();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, name, flat_number, block, browse_beyond_community)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'flat_number', ''),
    COALESCE(NEW.raw_user_meta_data->>'block', ''),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'buyer') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
