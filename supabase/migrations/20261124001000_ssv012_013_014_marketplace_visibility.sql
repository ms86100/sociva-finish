-- Staging only. SSV-012/013/014 marketplace visibility.
-- Society ops stay membership-scoped. Radius search is the commerce exception.
-- RPCs that call sociva_assert_rate_limit are VOLATILE.

-- SSV-012: approved private stores are not globally readable.
DROP POLICY IF EXISTS "Anyone can view approved sellers" ON public.seller_profiles;

CREATE POLICY "seller_profiles_select_storefront"
ON public.seller_profiles
FOR SELECT
USING (
  (user_id = (SELECT auth.uid()))
  OR public.is_admin((SELECT auth.uid()))
  OR (
    verification_status = 'approved'
    AND (
      society_id = public.get_user_society_id((SELECT auth.uid()))
      OR COALESCE(sell_beyond_community, false) = true
    )
  )
);

REVOKE SELECT ON TABLE public.seller_profiles FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id, user_id, business_name, description, categories, cover_image_url, is_available,
  availability_start, availability_end, accepts_cod, verification_status, rating, total_reviews,
  created_at, updated_at, profile_image_url, is_featured, operating_days, accepts_upi, upi_id,
  society_id, fssai_number, primary_group, delivery_fee, packaging_fee, service_radius_km,
  min_order_amount, avg_preparation_time, cancellation_policy, razorpay_onboarding_status,
  food_license_url, food_license_status, food_license_submitted_at, food_license_reviewed_at,
  sell_beyond_community, delivery_radius_km, avg_response_minutes, last_active_at,
  completed_order_count, cancellation_rate, fulfillment_mode, delivery_note, attribute_blocks,
  delivery_handled_by, otp_required, delivery_instructions, manual_override, manual_override_until,
  latitude, longitude, search_radius_km, payment_collection, minimum_order_amount, daily_order_limit,
  vacation_mode, vacation_until, pickup_payment_config, delivery_payment_config, subcategory_preferences,
  rejection_note, seller_type, store_location_source, default_action_type, low_stock_alert_threshold,
  on_time_delivery_pct, store_location_label, reliability_score, reliability_updated_at,
  auto_accept_enabled, upi_holder_name, upi_verified_at, upi_provider, upi_verification_status,
  categories_deferred, booking_slot_minutes, booking_slot_buffer_minutes, booking_slot_max_capacity,
  onboarding_meta, home_service_available, home_service_fee
) ON public.seller_profiles TO anon, authenticated;

-- Authenticated keep bank SELECT so owner/admin `select *` still works.
-- Anon cannot read bank columns. Cross-society private stores are hidden by RLS.
GRANT SELECT (
  bank_account_number,
  bank_ifsc_code,
  bank_account_holder,
  razorpay_account_id
) ON public.seller_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_own_seller_payout_fields(_seller_id uuid)
RETURNS TABLE (
  seller_id uuid,
  bank_account_number text,
  bank_ifsc_code text,
  bank_account_holder text,
  razorpay_account_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sp.id,
    sp.bank_account_number,
    sp.bank_ifsc_code,
    sp.bank_account_holder,
    sp.razorpay_account_id
  FROM public.seller_profiles sp
  WHERE sp.id = _seller_id
    AND (sp.user_id = auth.uid() OR public.is_admin(auth.uid()));
END;
$$;

REVOKE ALL ON FUNCTION public.get_own_seller_payout_fields(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_seller_payout_fields(uuid) TO authenticated, service_role;

-- SSV-014: table SELECT is home-society / owner / admin / in-cart / prior order.
-- Cross-society opted-in listings stay on rate-limited search RPCs.
DROP POLICY IF EXISTS "Approved products visible in home society or opted-in radius se" ON public.products;
DROP POLICY IF EXISTS "Anyone can view available products from approved sellers" ON public.products;

CREATE POLICY "products_select_home_society_owner_admin"
ON public.products
FOR SELECT
USING (
  public.is_admin((SELECT auth.uid()))
  OR EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = products.seller_id
      AND sp.user_id = (SELECT auth.uid())
  )
  OR (
    approval_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = products.seller_id
        AND sp.verification_status = 'approved'
        AND public.seller_credit_activation_satisfied(sp.id)
        AND sp.society_id = public.get_user_society_id((SELECT auth.uid()))
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.cart_items ci
    WHERE ci.product_id = products.id
      AND ci.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = products.id
      AND o.buyer_id = (SELECT auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.get_marketplace_product(_product_id uuid)
RETURNS SETOF public.products
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'marketplace_product:' || coalesce(auth.uid()::text, 'anon'),
    60,
    60
  );

  RETURN QUERY
  SELECT p.*
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE p.id = _product_id
    AND p.approval_status = 'approved'
    AND sp.verification_status = 'approved'
    AND public.seller_credit_activation_satisfied(sp.id)
    AND (
      sp.user_id = auth.uid()
      OR public.is_admin(auth.uid())
      OR sp.society_id = public.get_user_society_id(auth.uid())
      OR COALESCE(sp.sell_beyond_community, false) = true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_marketplace_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketplace_product(uuid) TO anon, authenticated, service_role;

-- SSV-013: pin buyer society from JWT membership. Ignore client _buyer_society_id.
-- Keep the argument for API compatibility.
CREATE OR REPLACE FUNCTION public.search_products_v2(
  _query text DEFAULT ''::text,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision,
  _radius_km double precision DEFAULT 10,
  _buyer_society_id uuid DEFAULT NULL::uuid,
  _categories text[] DEFAULT NULL::text[],
  _min_rating numeric DEFAULT 0,
  _is_veg boolean DEFAULT NULL::boolean,
  _min_price numeric DEFAULT NULL::numeric,
  _max_price numeric DEFAULT NULL::numeric,
  _sort_by text DEFAULT NULL::text,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  price numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  action_type text,
  description text,
  brand text,
  mrp numeric,
  discount_percentage numeric,
  seller_id uuid,
  seller_name text,
  seller_rating numeric,
  seller_total_reviews integer,
  seller_profile_image text,
  society_name text,
  is_same_society boolean,
  distance_km double precision,
  rank real,
  retrieval_mode text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
DECLARE
  v_buyer uuid;
BEGIN
  v_buyer := public.get_user_society_id(auth.uid());

  RETURN QUERY
  SELECT u.*
  FROM public.search_products_v2_unscoped(
    _query, _lat, _lng, _radius_km, v_buyer, _categories,
    _min_rating, _is_veg, _min_price, _max_price, _sort_by, _limit, _offset
  ) u
  WHERE COALESCE(u.is_same_society, false) = true
     OR (
       _lat IS NOT NULL
       AND _lng IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.seller_profiles sp
         WHERE sp.id = u.seller_id
           AND COALESCE(sp.sell_beyond_community, false) = true
       )
     );
END;
$$;

REVOKE ALL ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_products_v2_unscoped(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_products_v2_unscoped(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) TO service_role;
