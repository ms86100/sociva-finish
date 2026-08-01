
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _society_id uuid;
BEGIN
  -- Sanitize society_id: reject non-UUID values like "pending"
  BEGIN
    _society_id := (NEW.raw_user_meta_data->>'society_id')::uuid;
    -- Verify it actually exists
    PERFORM 1 FROM public.societies WHERE id = _society_id;
    IF NOT FOUND THEN _society_id := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN
    _society_id := NULL;
  END;

  INSERT INTO public.profiles (id, email, name, phone, flat_number, block, phase, society_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'flat_number', ''),
    COALESCE(NEW.raw_user_meta_data->>'block', ''),
    NULLIF(NEW.raw_user_meta_data->>'phase', ''),
    _society_id
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'buyer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
