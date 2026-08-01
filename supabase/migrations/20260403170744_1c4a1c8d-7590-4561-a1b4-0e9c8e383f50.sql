
-- 1. Add store_location_label column
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS store_location_label text;

-- 2. Replace RPC to accept optional label
CREATE OR REPLACE FUNCTION public.set_my_store_coordinates(
  p_lat double precision,
  p_lng double precision,
  p_source text DEFAULT 'manual',
  p_label text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.seller_profiles
  SET latitude = p_lat,
      longitude = p_lng,
      store_location_source = p_source,
      store_location_label = COALESCE(p_label, store_location_label)
  WHERE user_id = auth.uid();
END; $$;
