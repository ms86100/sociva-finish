-- One predicate per command-center bucket, shared by the snapshot count and the list.
-- Orders today uses midnight Asia/Kolkata inside SQL. The browser must not send its own midnight.

CREATE OR REPLACE FUNCTION public.admin_cc_ist_day_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (timezone('Asia/Kolkata', now()))::date::timestamp AT TIME ZONE 'Asia/Kolkata';
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_order_is_today(p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_created_at >= public.admin_cc_ist_day_start();
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_seller_is_pending(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_status = 'pending';
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_product_is_pending(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_status = 'pending';
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_payment_is_waiting(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_status IN ('pending', 'payment_pending', 'awaiting_payment');
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_dispute_ticket_is_open(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_status, '') NOT IN ('resolved', 'closed');
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_dispute_is_open(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_status, '') NOT IN ('resolved', 'closed', 'rejected');
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_enquiry_is_unanswered(p_order_id uuid, p_status text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_status = 'enquired'
    AND NOT EXISTS (
      SELECT 1
      FROM public.seller_contact_interactions sci
      WHERE sci.order_id = p_order_id
        AND sci.status IN ('responded', 'closed')
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_cc_bucket_counts(p_society_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'pending_stores', (
      SELECT count(*)::integer
      FROM public.seller_profiles sp
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND public.admin_cc_seller_is_pending(sp.verification_status::text)
    ),
    'pending_products', (
      SELECT count(*)::integer
      FROM public.products p
      JOIN public.seller_profiles sp ON sp.id = p.seller_id
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND public.admin_cc_product_is_pending(p.approval_status::text)
    ),
    'orders_today', (
      SELECT count(*)::integer
      FROM public.orders o
      WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
        AND public.admin_cc_order_is_today(o.created_at)
    ),
    'unanswered_enquiries', (
      SELECT count(*)::integer
      FROM public.orders o
      WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
        AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
        AND public.admin_cc_enquiry_is_unanswered(o.id, o.status::text)
    ),
    'open_disputes', (
      SELECT count(*)::integer FROM (
        SELECT d.id
        FROM public.disputes d
        JOIN public.orders o ON o.id = d.order_id
        WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
          AND public.admin_cc_dispute_is_open(d.status::text)
        UNION ALL
        SELECT dt.id
        FROM public.dispute_tickets dt
        JOIN public.orders o ON o.id = dt.order_id
        WHERE (p_society_id IS NULL OR dt.society_id = p_society_id)
          AND public.admin_cc_dispute_ticket_is_open(dt.status::text)
      ) open_rows
    ),
    'payment_waiting', (
      SELECT count(*)::integer
      FROM public.orders o
      WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
        AND public.admin_cc_payment_is_waiting(o.payment_status::text)
    )
  );
END;
$$;

-- Snapshot keeps the wider report fields, but the six action numbers are the bucket counts.
ALTER FUNCTION public.admin_get_command_center_snapshot(uuid)
  RENAME TO admin_get_command_center_snapshot_legacy;

CREATE OR REPLACE FUNCTION public.admin_get_command_center_snapshot(
  p_society_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_buckets jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  v_buckets := public.admin_cc_bucket_counts(p_society_id);
  v_result := public.admin_get_command_center_snapshot_legacy(p_society_id);
  v_result := jsonb_set(v_result, '{buckets}', v_buckets, true);
  v_result := jsonb_set(v_result, '{sellers,pending}', v_buckets->'pending_stores', true);
  v_result := jsonb_set(v_result, '{listings,pending_products}', v_buckets->'pending_products', true);
  v_result := jsonb_set(v_result, '{orders,today}', v_buckets->'orders_today', true);
  v_result := jsonb_set(v_result, '{orders,payment_pending}', v_buckets->'payment_waiting', true);
  v_result := jsonb_set(v_result, '{enquiries,unanswered}', v_buckets->'unanswered_enquiries', true);
  v_result := jsonb_set(v_result, '{disputes,open}', v_buckets->'open_disputes', true);
  v_result := jsonb_set(v_result, '{attention,pending_store_verifications}', v_buckets->'pending_stores', true);
  v_result := jsonb_set(v_result, '{attention,pending_product_approvals}', v_buckets->'pending_products', true);
  v_result := jsonb_set(v_result, '{attention,open_disputes}', v_buckets->'open_disputes', true);
  v_result := jsonb_set(v_result, '{attention,payment_pending_orders}', v_buckets->'payment_waiting', true);
  v_result := jsonb_set(v_result, '{attention,unanswered_enquiries}', v_buckets->'unanswered_enquiries', true);
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
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_status text := NULLIF(btrim(COALESCE(p_verification_status, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'total', (
      SELECT count(*)::integer
      FROM public.seller_profiles sp
      LEFT JOIN public.profiles pr ON pr.id = sp.user_id
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND (
          v_status IS NULL
          OR (v_status = 'pending' AND public.admin_cc_seller_is_pending(sp.verification_status::text))
          OR (v_status IS DISTINCT FROM 'pending' AND sp.verification_status::text = v_status)
        )
        AND (
          p_active_only IS NULL OR
          (p_active_only = true AND COALESCE(sp.is_available, false) AND COALESCE(sp.vacation_mode, false) = false) OR
          (p_active_only = false AND (NOT COALESCE(sp.is_available, false) OR COALESCE(sp.vacation_mode, false)))
        )
        AND (p_search IS NULL OR btrim(p_search) = '' OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
          OR sp.id::text ILIKE '%' || btrim(p_search) || '%' OR pr.phone ILIKE '%' || btrim(p_search) || '%' OR pr.name ILIKE '%' || btrim(p_search) || '%')
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT sp.id AS seller_id, sp.business_name, sp.verification_status,
          COALESCE(sp.is_available, false) AS is_available,
          COALESCE(sp.vacation_mode, false) AS vacation_mode,
          sp.society_id, soc.name AS society_name,
          pr.name AS owner_name, pr.phone AS owner_phone,
          sp.created_at, sp.rating, sp.total_reviews,
          sp.fulfillment_mode, sp.last_active_at,
          (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id) AS product_count,
          (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id AND p.approval_status = 'approved' AND COALESCE(p.is_available, false)) AS live_product_count,
          (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.created_at >= now() - interval '30 days') AS orders_30d,
          (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND public.admin_cc_enquiry_is_unanswered(o.id, o.status::text)) AS unanswered_enquiries
        FROM public.seller_profiles sp
        LEFT JOIN public.profiles pr ON pr.id = sp.user_id
        LEFT JOIN public.societies soc ON soc.id = sp.society_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (
            v_status IS NULL
            OR (v_status = 'pending' AND public.admin_cc_seller_is_pending(sp.verification_status::text))
            OR (v_status IS DISTINCT FROM 'pending' AND sp.verification_status::text = v_status)
          )
          AND (
            p_active_only IS NULL OR
            (p_active_only = true AND COALESCE(sp.is_available, false) AND COALESCE(sp.vacation_mode, false) = false) OR
            (p_active_only = false AND (NOT COALESCE(sp.is_available, false) OR COALESCE(sp.vacation_mode, false)))
          )
          AND (p_search IS NULL OR btrim(p_search) = '' OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
            OR sp.id::text ILIKE '%' || btrim(p_search) || '%' OR pr.phone ILIKE '%' || btrim(p_search) || '%' OR pr.name ILIKE '%' || btrim(p_search) || '%')
        ORDER BY sp.created_at DESC
        LIMIT v_limit OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

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
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_status text := NULLIF(btrim(COALESCE(p_approval_status, '')), '');
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
        AND (
          v_status IS NULL
          OR (v_status = 'pending' AND public.admin_cc_product_is_pending(p.approval_status::text))
          OR (v_status IS DISTINCT FROM 'pending' AND p.approval_status::text = v_status)
        )
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
          AND (
            v_status IS NULL
            OR (v_status = 'pending' AND public.admin_cc_product_is_pending(p.approval_status::text))
            OR (v_status IS DISTINCT FROM 'pending' AND p.approval_status::text = v_status)
          )
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
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_payment_status text := NULLIF(btrim(COALESCE(p_payment_status, '')), '');
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
        AND (
          v_status IS NULL
          OR (v_status = 'orders_today' AND public.admin_cc_order_is_today(o.created_at))
          OR (v_status IS DISTINCT FROM 'orders_today' AND o.status::text = v_status)
        )
        AND (
          v_payment_status IS NULL
          OR (v_payment_status = 'pending_any' AND public.admin_cc_payment_is_waiting(o.payment_status::text))
          OR (v_payment_status IS DISTINCT FROM 'pending_any' AND o.payment_status::text = v_payment_status)
        )
        AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
        AND (
          v_status = 'orders_today'
          OR p_from IS NULL
          OR o.created_at >= p_from
        )
        AND (p_to IS NULL OR o.created_at < p_to)
        AND (p_search IS NULL OR btrim(p_search) = '' OR o.id::text ILIKE '%' || btrim(p_search) || '%'
          OR bp.name ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          o.id AS order_id, o.status, o.payment_status, o.payment_type, o.order_type,
          o.total_amount, o.society_id, soc.name AS society_name,
          o.seller_id, sp.business_name AS seller_name,
          o.buyer_id, bp.name AS buyer_name, bp.phone AS buyer_phone,
          o.created_at, o.fulfillment_type, o.delivery_handled_by,
          (SELECT string_agg(DISTINCT oi.product_name, ', ' ORDER BY oi.product_name)
           FROM public.order_items oi WHERE oi.order_id = o.id) AS product_summary,
          (SELECT string_agg(DISTINCT p.category, ', ')
           FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id) AS categories,
          EXISTS (SELECT 1 FROM public.disputes d WHERE d.order_id = o.id) AS has_dispute,
          COALESCE(
            (SELECT d.status FROM public.disputes d WHERE d.order_id = o.id ORDER BY d.created_at DESC LIMIT 1),
            (SELECT dt.status FROM public.dispute_tickets dt WHERE dt.order_id = o.id ORDER BY dt.created_at DESC LIMIT 1)
          ) AS dispute_status
        FROM public.orders o
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.societies soc ON soc.id = o.society_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (
            v_status IS NULL
            OR (v_status = 'orders_today' AND public.admin_cc_order_is_today(o.created_at))
            OR (v_status IS DISTINCT FROM 'orders_today' AND o.status::text = v_status)
          )
          AND (
            v_payment_status IS NULL
            OR (v_payment_status = 'pending_any' AND public.admin_cc_payment_is_waiting(o.payment_status::text))
            OR (v_payment_status IS DISTINCT FROM 'pending_any' AND o.payment_status::text = v_payment_status)
          )
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (
            v_status = 'orders_today'
            OR p_from IS NULL
            OR o.created_at >= p_from
          )
          AND (p_to IS NULL OR o.created_at < p_to)
          AND (p_search IS NULL OR btrim(p_search) = '' OR o.id::text ILIKE '%' || btrim(p_search) || '%'
            OR bp.name ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
        ORDER BY o.created_at DESC
        LIMIT v_limit OFFSET v_offset
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
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
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
        AND (
          v_status IS NULL
          OR (v_status = 'open' AND o.status::text IN ('enquired', 'quoted'))
          OR (v_status = 'unanswered' AND public.admin_cc_enquiry_is_unanswered(o.id, o.status::text))
          OR (
            v_status IS DISTINCT FROM 'open'
            AND v_status IS DISTINCT FROM 'unanswered'
            AND o.status::text = v_status
          )
        )
        AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
        AND (p_from IS NULL OR o.created_at >= p_from)
        AND (p_to IS NULL OR o.created_at < p_to)
        AND (p_search IS NULL OR btrim(p_search) = '' OR o.id::text ILIKE '%' || btrim(p_search) || '%'
          OR bp.name ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          o.id AS enquiry_id, o.status, o.order_type, o.total_amount,
          o.society_id, soc.name AS society_name,
          o.seller_id, sp.business_name AS seller_name,
          o.buyer_id, bp.name AS buyer_name, bp.phone AS buyer_phone,
          o.created_at, o.updated_at,
          (SELECT string_agg(DISTINCT oi.product_name, ', ') FROM public.order_items oi WHERE oi.order_id = o.id) AS product_summary,
          EXISTS (SELECT 1 FROM public.seller_contact_interactions sci WHERE sci.order_id = o.id) AS has_conversation,
          EXISTS (
            SELECT 1 FROM public.seller_contact_interactions sci
            WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
          ) AS seller_responded,
          (SELECT sci.conversation_id FROM public.seller_contact_interactions sci
           WHERE sci.order_id = o.id ORDER BY sci.created_at DESC LIMIT 1) AS conversation_id
        FROM public.orders o
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.societies soc ON soc.id = o.society_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
          AND (
            v_status IS NULL
            OR (v_status = 'open' AND o.status::text IN ('enquired', 'quoted'))
            OR (v_status = 'unanswered' AND public.admin_cc_enquiry_is_unanswered(o.id, o.status::text))
            OR (
              v_status IS DISTINCT FROM 'open'
              AND v_status IS DISTINCT FROM 'unanswered'
              AND o.status::text = v_status
            )
          )
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at < p_to)
          AND (p_search IS NULL OR btrim(p_search) = '' OR o.id::text ILIKE '%' || btrim(p_search) || '%'
            OR bp.name ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
        ORDER BY o.created_at DESC
        LIMIT v_limit OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_disputes_filtered(
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
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'total', (
      SELECT count(*)::integer FROM (
        SELECT d.id FROM public.disputes d
        JOIN public.orders o ON o.id = d.order_id
        LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
        WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
          AND (
            v_status IS NULL
            OR (v_status = 'open' AND public.admin_cc_dispute_is_open(d.status::text))
            OR (v_status IS DISTINCT FROM 'open' AND d.status::text = v_status)
          )
          AND (p_seller_id IS NULL OR d.seller_id = p_seller_id)
          AND (p_from IS NULL OR d.created_at >= p_from)
          AND (p_to IS NULL OR d.created_at < p_to)
          AND (p_search IS NULL OR btrim(p_search) = '' OR d.id::text ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
        UNION ALL
        SELECT dt.id FROM public.dispute_tickets dt
        JOIN public.orders o ON o.id = dt.order_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        WHERE (p_society_id IS NULL OR dt.society_id = p_society_id)
          AND (
            v_status IS NULL
            OR (v_status = 'open' AND public.admin_cc_dispute_ticket_is_open(dt.status::text))
            OR (v_status IS DISTINCT FROM 'open' AND dt.status::text = v_status)
          )
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (p_from IS NULL OR dt.created_at >= p_from)
          AND (p_to IS NULL OR dt.created_at < p_to)
          AND (p_search IS NULL OR btrim(p_search) = '' OR dt.id::text ILIKE '%' || btrim(p_search) || '%' OR dt.category ILIKE '%' || btrim(p_search) || '%')
      ) u
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT * FROM (
          SELECT
            d.id AS dispute_id,
            'order_dispute'::text AS dispute_kind,
            d.status,
            d.reason,
            d.order_id,
            d.seller_id,
            sp.business_name AS seller_name,
            d.buyer_id,
            bp.name AS buyer_name,
            d.created_at,
            d.resolved_at,
            d.resolution_notes AS resolution_note
          FROM public.disputes d
          JOIN public.orders ord ON ord.id = d.order_id
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
          WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
            AND (
              v_status IS NULL
              OR (v_status = 'open' AND public.admin_cc_dispute_is_open(d.status::text))
              OR (v_status IS DISTINCT FROM 'open' AND d.status::text = v_status)
            )
            AND (p_seller_id IS NULL OR d.seller_id = p_seller_id)
            AND (p_from IS NULL OR d.created_at >= p_from)
            AND (p_to IS NULL OR d.created_at < p_to)
            AND (p_search IS NULL OR btrim(p_search) = '' OR d.id::text ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
          UNION ALL
          SELECT
            dt.id,
            'society_ticket'::text,
            dt.status,
            dt.reason,
            dt.order_id,
            o.seller_id,
            sp.business_name,
            dt.raised_by,
            pr.name,
            dt.created_at,
            dt.resolved_at,
            dt.resolution_note
          FROM public.dispute_tickets dt
          JOIN public.orders o ON o.id = dt.order_id
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          LEFT JOIN public.profiles pr ON pr.id = dt.raised_by
          WHERE (p_society_id IS NULL OR dt.society_id = p_society_id)
            AND (
              v_status IS NULL
              OR (v_status = 'open' AND public.admin_cc_dispute_ticket_is_open(dt.status::text))
              OR (v_status IS DISTINCT FROM 'open' AND dt.status::text = v_status)
            )
            AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
            AND (p_from IS NULL OR dt.created_at >= p_from)
            AND (p_to IS NULL OR dt.created_at < p_to)
            AND (p_search IS NULL OR btrim(p_search) = '' OR dt.id::text ILIKE '%' || btrim(p_search) || '%' OR dt.category ILIKE '%' || btrim(p_search) || '%')
        ) combined
        ORDER BY created_at DESC
        LIMIT v_limit OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cc_ist_day_start() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_order_is_today(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_seller_is_pending(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_product_is_pending(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_payment_is_waiting(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_dispute_ticket_is_open(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_dispute_is_open(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_enquiry_is_unanswered(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cc_bucket_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_command_center_snapshot_legacy(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_command_center_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_sellers_filtered(uuid, text, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_products_filtered(uuid, text, text, uuid, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_orders_filtered(uuid, text, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_enquiries_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_disputes_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
