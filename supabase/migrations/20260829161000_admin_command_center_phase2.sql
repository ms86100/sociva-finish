-- Admin Command Center Phase 2: products, bookings, and enquiries list RPCs.

CREATE OR REPLACE FUNCTION public.admin_list_products_filtered(
  p_society_id uuid DEFAULT NULL,
  p_approval_status text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_available_only boolean DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'total', (
      SELECT count(*)::integer
      FROM public.products p
      JOIN public.seller_profiles sp ON sp.id = p.seller_id
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND (p_approval_status IS NULL OR btrim(p_approval_status) = '' OR p.approval_status::text = p_approval_status)
        AND (p_category IS NULL OR btrim(p_category) = '' OR p.category = p_category)
        AND (p_seller_id IS NULL OR p.seller_id = p_seller_id)
        AND (
          p_available_only IS NULL
          OR (p_available_only = true AND COALESCE(p.is_available, false))
          OR (p_available_only = false AND NOT COALESCE(p.is_available, false))
        )
        AND (
          p_search IS NULL OR btrim(p_search) = ''
          OR p.name ILIKE '%' || btrim(p_search) || '%'
          OR p.id::text ILIKE '%' || btrim(p_search) || '%'
          OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          p.id AS product_id,
          p.name,
          p.category,
          p.subcategory_id,
          sc.name AS subcategory_name,
          p.price,
          p.approval_status,
          COALESCE(p.is_available, false) AS is_available,
          p.seller_id,
          sp.business_name AS seller_name,
          sp.society_id,
          soc.name AS society_name,
          EXISTS (SELECT 1 FROM public.service_listings sl WHERE sl.product_id = p.id) AS is_service,
          p.created_at,
          p.updated_at
        FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        LEFT JOIN public.societies soc ON soc.id = sp.society_id
        LEFT JOIN public.subcategories sc ON sc.id = p.subcategory_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_approval_status IS NULL OR btrim(p_approval_status) = '' OR p.approval_status::text = p_approval_status)
          AND (p_category IS NULL OR btrim(p_category) = '' OR p.category = p_category)
          AND (p_seller_id IS NULL OR p.seller_id = p_seller_id)
          AND (
            p_available_only IS NULL
            OR (p_available_only = true AND COALESCE(p.is_available, false))
            OR (p_available_only = false AND NOT COALESCE(p.is_available, false))
          )
          AND (
            p_search IS NULL OR btrim(p_search) = ''
            OR p.name ILIKE '%' || btrim(p_search) || '%'
            OR p.id::text ILIKE '%' || btrim(p_search) || '%'
            OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
          )
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
        LIMIT v_limit
        OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_bookings_filtered(
  p_society_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'total', (
      SELECT count(*)::integer
      FROM public.service_bookings sb
      JOIN public.seller_profiles sp ON sp.id = sb.seller_id
      LEFT JOIN public.profiles bp ON bp.id = sb.buyer_id
      LEFT JOIN public.products p ON p.id = sb.product_id
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND (p_status IS NULL OR btrim(p_status) = '' OR sb.status = p_status)
        AND (p_seller_id IS NULL OR sb.seller_id = p_seller_id)
        AND (p_from IS NULL OR sb.created_at >= p_from)
        AND (p_to IS NULL OR sb.created_at < p_to)
        AND (
          p_search IS NULL OR btrim(p_search) = ''
          OR sb.id::text ILIKE '%' || btrim(p_search) || '%'
          OR bp.name ILIKE '%' || btrim(p_search) || '%'
          OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
          OR p.name ILIKE '%' || btrim(p_search) || '%'
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          sb.id AS booking_id,
          sb.status,
          sb.booking_date,
          sb.start_time,
          sb.end_time,
          sb.location_type,
          sb.seller_id,
          sp.business_name AS seller_name,
          sb.buyer_id,
          bp.name AS buyer_name,
          bp.phone AS buyer_phone,
          sb.product_id,
          p.name AS product_name,
          p.category,
          sb.order_id,
          sb.created_at
        FROM public.service_bookings sb
        JOIN public.seller_profiles sp ON sp.id = sb.seller_id
        LEFT JOIN public.profiles bp ON bp.id = sb.buyer_id
        LEFT JOIN public.products p ON p.id = sb.product_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_status IS NULL OR btrim(p_status) = '' OR sb.status = p_status)
          AND (p_seller_id IS NULL OR sb.seller_id = p_seller_id)
          AND (p_from IS NULL OR sb.created_at >= p_from)
          AND (p_to IS NULL OR sb.created_at < p_to)
          AND (
            p_search IS NULL OR btrim(p_search) = ''
            OR sb.id::text ILIKE '%' || btrim(p_search) || '%'
            OR bp.name ILIKE '%' || btrim(p_search) || '%'
            OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
            OR p.name ILIKE '%' || btrim(p_search) || '%'
          )
        ORDER BY sb.created_at DESC
        LIMIT v_limit
        OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_enquiries_filtered(
  p_society_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'total', (
      SELECT count(*)::integer
      FROM public.orders o
      LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
      LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
        AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
        AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
        AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
        AND (p_from IS NULL OR o.created_at >= p_from)
        AND (p_to IS NULL OR o.created_at < p_to)
        AND (
          p_search IS NULL OR btrim(p_search) = ''
          OR o.id::text ILIKE '%' || btrim(p_search) || '%'
          OR bp.name ILIKE '%' || btrim(p_search) || '%'
          OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          o.id AS enquiry_id,
          o.status,
          o.order_type,
          o.total_amount,
          o.society_id,
          soc.name AS society_name,
          o.seller_id,
          sp.business_name AS seller_name,
          o.buyer_id,
          bp.name AS buyer_name,
          bp.phone AS buyer_phone,
          o.created_at,
          o.updated_at
        FROM public.orders o
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.societies soc ON soc.id = o.society_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
          AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at < p_to)
          AND (
            p_search IS NULL OR btrim(p_search) = ''
            OR o.id::text ILIKE '%' || btrim(p_search) || '%'
            OR bp.name ILIKE '%' || btrim(p_search) || '%'
            OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
          )
        ORDER BY o.created_at DESC
        LIMIT v_limit
        OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_products_filtered(uuid, text, text, uuid, boolean, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_bookings_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_enquiries_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_products_filtered(uuid, text, text, uuid, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_bookings_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_enquiries_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
