-- Vacation mode is meant to keep the store listed with an On a break banner
-- and block orders. It was incorrectly treated as "not discoverable", so buyers
-- saw "not available for your location" instead of the banner.

CREATE OR REPLACE FUNCTION public.seller_is_eligible_for_discovery(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sp public.seller_profiles;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = p_seller_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_sp.verification_status IS DISTINCT FROM 'approved' THEN
    RETURN false;
  END IF;
  IF COALESCE(v_sp.is_available, false) IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF v_sp.latitude IS NULL OR v_sp.longitude IS NULL THEN
    RETURN false;
  END IF;
  IF COALESCE(v_sp.delivery_radius_km, 0) <= 0 THEN
    RETURN false;
  END IF;
  RETURN public.seller_credit_activation_satisfied(p_seller_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.buyer_can_order_from_seller(
  p_seller_id uuid,
  p_buyer_lat double precision,
  p_buyer_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_vacation boolean;
BEGIN
  IF NOT public.buyer_coordinates_are_valid(p_buyer_lat, p_buyer_lng) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'buyer_location');
  END IF;
  IF NOT public.seller_is_discoverable_to_buyer(p_seller_id, p_buyer_lat, p_buyer_lng) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;
  SELECT COALESCE(sp.vacation_mode, false)
    INTO v_vacation
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;
  IF COALESCE(v_vacation, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'vacation');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
