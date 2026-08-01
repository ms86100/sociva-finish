CREATE OR REPLACE FUNCTION public.set_my_society_coordinates(p_lat double precision, p_lng double precision)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _society_id uuid;
BEGIN
  SELECT society_id INTO _society_id FROM seller_profiles WHERE user_id = auth.uid() LIMIT 1;
  IF _society_id IS NULL THEN RAISE EXCEPTION 'No seller profile found'; END IF;
  UPDATE societies SET latitude = p_lat, longitude = p_lng
  WHERE id = _society_id AND latitude IS NULL AND longitude IS NULL;
END;
$$;