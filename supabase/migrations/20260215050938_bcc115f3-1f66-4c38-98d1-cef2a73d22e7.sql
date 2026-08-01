
-- Fix 1: Products RLS - allow cross-society visibility for opted-in sellers
DROP POLICY IF EXISTS "Anyone can view available products from approved sellers" ON products;

CREATE POLICY "Anyone can view available products from approved sellers"
ON products FOR SELECT USING (
  -- Seller owns the product
  EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.user_id = auth.uid()
  )
  -- Admin
  OR is_admin(auth.uid())
  -- Same society
  OR EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.verification_status = 'approved'
      AND seller_profiles.society_id = get_user_society_id(auth.uid())
  )
  -- Cross-society: seller opted in
  OR EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.verification_status = 'approved'
      AND seller_profiles.sell_beyond_community = true
  )
);

-- Fix 4: Radius validation triggers
CREATE OR REPLACE FUNCTION public.validate_delivery_radius()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.delivery_radius_km IS NOT NULL
     AND (NEW.delivery_radius_km < 1 OR NEW.delivery_radius_km > 10) THEN
    RAISE EXCEPTION 'delivery_radius_km must be between 1 and 10';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_delivery_radius
  BEFORE INSERT OR UPDATE ON seller_profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_radius();

CREATE OR REPLACE FUNCTION public.validate_search_radius()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.search_radius_km IS NOT NULL
     AND (NEW.search_radius_km < 1 OR NEW.search_radius_km > 10) THEN
    RAISE EXCEPTION 'search_radius_km must be between 1 and 10';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_search_radius
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_search_radius();
