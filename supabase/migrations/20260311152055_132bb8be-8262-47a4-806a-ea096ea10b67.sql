CREATE OR REPLACE FUNCTION public.set_my_society_coordinates(p_lat double precision, p_lng double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _society_id uuid; _found boolean;
BEGIN
  SELECT society_id, true INTO _society_id, _found
  FROM seller_profiles WHERE user_id = auth.uid() LIMIT 1;
  
  IF NOT COALESCE(_found, false) THEN
    RAISE EXCEPTION 'No seller profile found';
  END IF;
  
  IF _society_id IS NULL THEN
    RAISE EXCEPTION 'No society assigned to your seller profile. Please update your store settings first.';
  END IF;
  
  UPDATE societies SET latitude = p_lat, longitude = p_lng
  WHERE id = _society_id AND latitude IS NULL AND longitude IS NULL;
END; $$;