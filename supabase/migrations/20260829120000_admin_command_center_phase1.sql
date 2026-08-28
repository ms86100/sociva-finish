-- Phase 1 Admin Command Center: snapshot + filtered seller/order lists

CREATE OR REPLACE FUNCTION public.admin_get_command_center_snapshot(
  p_society_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', v_now);
  v_week_start timestamptz := v_now - interval '7 days';
  v_month_start timestamptz := v_now - interval '30 days';
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  WITH scoped_sellers AS (
    SELECT sp.*
    FROM public.seller_profiles sp
    WHERE p_society_id IS NULL OR sp.society_id = p_society_id
  ),
  scoped_products AS (
    SELECT p.*
    FROM public.products p
    JOIN scoped_sellers sp ON sp.id = p.seller_id
  ),
  scoped_orders AS (
    SELECT o.*
    FROM public.orders o
    WHERE p_society_id IS NULL OR o.society_id = p_society_id
  ),
  scoped_bookings AS (
    SELECT sb.*
    FROM public.service_bookings sb
    JOIN scoped_sellers sp ON sp.id = sb.seller_id
  ),
  scoped_disputes AS (
    SELECT dt.*
    FROM public.dispute_tickets dt
    WHERE p_society_id IS NULL OR dt.society_id = p_society_id
  ),
  scoped_refunds AS (
    SELECT rr.*
    FROM public.refund_requests rr
    JOIN scoped_orders o ON o.id = rr.order_id
  ),
  order_status_rows AS (
    SELECT
      o.status::text AS status,
      count(*)::integer AS count
    FROM scoped_orders o
    GROUP BY o.status
  ),
  booking_status_rows AS (
    SELECT
      sb.status::text AS status,
      count(*)::integer AS count
    FROM scoped_bookings sb
    GROUP BY sb.status
  )
  SELECT jsonb_build_object(
    'society_id', p_society_id,
    'as_of', v_now,
    'sellers', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_sellers),
      'pending', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status = 'pending'),
      'approved', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status = 'approved'),
      'rejected', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status = 'rejected'),
      'active', (
        SELECT count(*)::integer
        FROM scoped_sellers
        WHERE COALESCE(is_available, false)
          AND COALESCE(vacation_mode, false) = false
      ),
      'on_vacation', (
        SELECT count(*)::integer
        FROM scoped_sellers
        WHERE COALESCE(vacation_mode, false)
      ),
      'ready_surface', (
        SELECT count(*)::integer
        FROM scoped_sellers
        WHERE verification_status = 'approved'
          AND COALESCE(is_available, false)
          AND COALESCE(vacation_mode, false) = false
      )
    ),
    'listings', jsonb_build_object(
      'total_products', (SELECT count(*)::integer FROM scoped_products),
      'live_products', (
        SELECT count(*)::integer
        FROM scoped_products
        WHERE approval_status = 'approved'
          AND COALESCE(is_available, false)
      ),
      'pending_products', (
        SELECT count(*)::integer
        FROM scoped_products
        WHERE approval_status = 'pending'
      ),
      'rejected_products', (
        SELECT count(*)::integer
        FROM scoped_products
        WHERE approval_status = 'rejected'
      ),
      'inactive_products', (
        SELECT count(*)::integer
        FROM scoped_products
        WHERE approval_status <> 'approved'
           OR COALESCE(is_available, false) = false
      )
    ),
    'orders', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_orders),
      'today', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE created_at >= v_today_start
      ),
      'week', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE created_at >= v_week_start
      ),
      'month', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE created_at >= v_month_start
      ),
      'payment_pending', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
      ),
      'by_status', COALESCE((
        SELECT jsonb_agg(to_jsonb(order_status_rows) ORDER BY count DESC)
        FROM order_status_rows
      ), '[]'::jsonb)
    ),
    'bookings', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_bookings),
      'by_status', COALESCE((
        SELECT jsonb_agg(to_jsonb(booking_status_rows) ORDER BY count DESC)
        FROM booking_status_rows
      ), '[]'::jsonb)
    ),
    'enquiries', jsonb_build_object(
      'open', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE status::text IN ('enquired', 'quoted')
      )
    ),
    'disputes', jsonb_build_object(
      'open', (
        SELECT count(*)::integer
        FROM scoped_disputes
        WHERE status NOT IN ('resolved', 'closed')
      ),
      'total', (SELECT count(*)::integer FROM scoped_disputes)
    ),
    'refunds', jsonb_build_object(
      'open', (
        SELECT count(*)::integer
        FROM scoped_refunds
        WHERE refund_state IN (
          'requested',
          'approved',
          'refund_initiated',
          'refund_processing',
          'needs_manual_review'
        )
      )
    ),
    'attention', jsonb_build_object(
      'pending_store_verifications', (
        SELECT count(*)::integer
        FROM scoped_sellers
        WHERE verification_status = 'pending'
      ),
      'pending_product_approvals', (
        SELECT count(*)::integer
        FROM scoped_products
        WHERE approval_status = 'pending'
      ),
      'open_disputes', (
        SELECT count(*)::integer
        FROM scoped_disputes
        WHERE status NOT IN ('resolved', 'closed')
      ),
      'open_refunds', (
        SELECT count(*)::integer
        FROM scoped_refunds
        WHERE refund_state IN (
          'requested',
          'approved',
          'refund_initiated',
          'refund_processing',
          'needs_manual_review'
        )
      ),
      'payment_pending_orders', (
        SELECT count(*)::integer
        FROM scoped_orders
        WHERE payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
      )
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_sellers_filtered(
  p_society_id uuid DEFAULT NULL,
  p_verification_status text DEFAULT NULL,
  p_active_only boolean DEFAULT NULL,
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
      FROM public.seller_profiles sp
      LEFT JOIN public.profiles pr ON pr.id = sp.user_id
      LEFT JOIN public.societies soc ON soc.id = sp.society_id
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND (p_verification_status IS NULL OR btrim(p_verification_status) = '' OR sp.verification_status::text = p_verification_status)
        AND (
          p_active_only IS NULL
          OR (
            p_active_only = true
            AND COALESCE(sp.is_available, false)
            AND COALESCE(sp.vacation_mode, false) = false
          )
          OR (
            p_active_only = false
            AND (NOT COALESCE(sp.is_available, false) OR COALESCE(sp.vacation_mode, false))
          )
        )
        AND (
          p_search IS NULL
          OR btrim(p_search) = ''
          OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
          OR sp.id::text ILIKE '%' || btrim(p_search) || '%'
          OR pr.phone ILIKE '%' || btrim(p_search) || '%'
          OR pr.name ILIKE '%' || btrim(p_search) || '%'
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          sp.id AS seller_id,
          sp.business_name,
          sp.verification_status,
          COALESCE(sp.is_available, false) AS is_available,
          COALESCE(sp.vacation_mode, false) AS vacation_mode,
          sp.society_id,
          soc.name AS society_name,
          pr.name AS owner_name,
          pr.phone AS owner_phone,
          sp.created_at,
          (
            SELECT count(*)::integer
            FROM public.products p
            WHERE p.seller_id = sp.id
          ) AS product_count,
          (
            SELECT count(*)::integer
            FROM public.products p
            WHERE p.seller_id = sp.id
              AND p.approval_status = 'approved'
              AND COALESCE(p.is_available, false)
          ) AS live_product_count,
          (
            SELECT count(*)::integer
            FROM public.orders o
            WHERE o.seller_id = sp.id
              AND o.created_at >= now() - interval '30 days'
          ) AS orders_30d
        FROM public.seller_profiles sp
        LEFT JOIN public.profiles pr ON pr.id = sp.user_id
        LEFT JOIN public.societies soc ON soc.id = sp.society_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_verification_status IS NULL OR btrim(p_verification_status) = '' OR sp.verification_status::text = p_verification_status)
          AND (
            p_active_only IS NULL
            OR (
              p_active_only = true
              AND COALESCE(sp.is_available, false)
              AND COALESCE(sp.vacation_mode, false) = false
            )
            OR (
              p_active_only = false
              AND (NOT COALESCE(sp.is_available, false) OR COALESCE(sp.vacation_mode, false))
            )
          )
          AND (
            p_search IS NULL
            OR btrim(p_search) = ''
            OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
            OR sp.id::text ILIKE '%' || btrim(p_search) || '%'
            OR pr.phone ILIKE '%' || btrim(p_search) || '%'
            OR pr.name ILIKE '%' || btrim(p_search) || '%'
          )
        ORDER BY sp.created_at DESC
        LIMIT v_limit
        OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_orders_filtered(
  p_society_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
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
        AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
        AND (p_payment_status IS NULL OR btrim(p_payment_status) = '' OR o.payment_status::text = p_payment_status)
        AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
        AND (p_from IS NULL OR o.created_at >= p_from)
        AND (p_to IS NULL OR o.created_at < p_to)
        AND (
          p_search IS NULL
          OR btrim(p_search) = ''
          OR o.id::text ILIKE '%' || btrim(p_search) || '%'
          OR bp.name ILIKE '%' || btrim(p_search) || '%'
          OR bp.phone ILIKE '%' || btrim(p_search) || '%'
          OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          o.id AS order_id,
          o.status,
          o.payment_status,
          o.payment_type,
          o.order_type,
          o.total_amount,
          o.society_id,
          soc.name AS society_name,
          o.seller_id,
          sp.business_name AS seller_name,
          o.buyer_id,
          bp.name AS buyer_name,
          bp.phone AS buyer_phone,
          o.created_at
        FROM public.orders o
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.societies soc ON soc.id = o.society_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
          AND (p_payment_status IS NULL OR btrim(p_payment_status) = '' OR o.payment_status::text = p_payment_status)
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at < p_to)
          AND (
            p_search IS NULL
            OR btrim(p_search) = ''
            OR o.id::text ILIKE '%' || btrim(p_search) || '%'
            OR bp.name ILIKE '%' || btrim(p_search) || '%'
            OR bp.phone ILIKE '%' || btrim(p_search) || '%'
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

REVOKE ALL ON FUNCTION public.admin_get_command_center_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_sellers_filtered(uuid, text, boolean, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_orders_filtered(uuid, text, text, uuid, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_command_center_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_sellers_filtered(uuid, text, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_orders_filtered(uuid, text, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
