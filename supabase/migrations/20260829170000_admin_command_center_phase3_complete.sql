-- Admin Command Center Phase 3: Store 360, disputes, activity timeline, global search,
-- category intelligence, and enriched list rows. Extends snapshot with full seller/store lifecycle.

-- ── Extended snapshot ─────────────────────────────────────────────────────────
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
    SELECT sp.* FROM public.seller_profiles sp
    WHERE p_society_id IS NULL OR sp.society_id = p_society_id
  ),
  scoped_products AS (
    SELECT p.* FROM public.products p
    JOIN scoped_sellers sp ON sp.id = p.seller_id
  ),
  scoped_services AS (
    SELECT p.* FROM scoped_products p
    WHERE EXISTS (SELECT 1 FROM public.service_listings sl WHERE sl.product_id = p.id)
  ),
  scoped_orders AS (
    SELECT o.* FROM public.orders o
    WHERE p_society_id IS NULL OR o.society_id = p_society_id
  ),
  scoped_bookings AS (
    SELECT sb.* FROM public.service_bookings sb
    JOIN scoped_sellers sp ON sp.id = sb.seller_id
  ),
  scoped_dispute_tickets AS (
    SELECT dt.* FROM public.dispute_tickets dt
    WHERE p_society_id IS NULL OR dt.society_id = p_society_id
  ),
  scoped_disputes AS (
    SELECT d.* FROM public.disputes d
    WHERE p_society_id IS NULL OR d.society_id = p_society_id
  ),
  scoped_refunds AS (
    SELECT rr.* FROM public.refund_requests rr
    JOIN scoped_orders o ON o.id = rr.order_id
  ),
  order_status_rows AS (
    SELECT o.status::text AS status, count(*)::integer AS count
    FROM scoped_orders o GROUP BY o.status
  ),
  booking_status_rows AS (
    SELECT sb.status::text AS status, count(*)::integer AS count
    FROM scoped_bookings sb GROUP BY sb.status
  )
  SELECT jsonb_build_object(
    'society_id', p_society_id,
    'as_of', v_now,
    'sellers', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_sellers),
      'pending', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'pending'),
      'approved', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'approved'),
      'rejected', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'rejected'),
      'suspended', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'suspended'),
      'draft', (SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'draft'),
      'completed_onboarding', (
        SELECT count(*)::integer FROM scoped_sellers
        WHERE verification_status::text = 'approved' AND society_id IS NOT NULL
      ),
      'active', (
        SELECT count(*)::integer FROM scoped_sellers
        WHERE COALESCE(is_available, false) AND COALESCE(vacation_mode, false) = false
          AND verification_status::text = 'approved'
      ),
      'inactive', (
        SELECT count(*)::integer FROM scoped_sellers
        WHERE verification_status::text = 'approved'
          AND (NOT COALESCE(is_available, false) OR COALESCE(vacation_mode, false))
      ),
      'on_vacation', (SELECT count(*)::integer FROM scoped_sellers WHERE COALESCE(vacation_mode, false)),
      'ready_surface', (
        SELECT count(*)::integer FROM scoped_sellers
        WHERE verification_status::text = 'approved'
          AND COALESCE(is_available, false) AND COALESCE(vacation_mode, false) = false
      )
    ),
    'listings', jsonb_build_object(
      'total_products', (SELECT count(*)::integer FROM scoped_products),
      'live_products', (
        SELECT count(*)::integer FROM scoped_products
        WHERE approval_status = 'approved' AND COALESCE(is_available, false)
      ),
      'pending_products', (SELECT count(*)::integer FROM scoped_products WHERE approval_status = 'pending'),
      'rejected_products', (SELECT count(*)::integer FROM scoped_products WHERE approval_status = 'rejected'),
      'inactive_products', (
        SELECT count(*)::integer FROM scoped_products
        WHERE approval_status <> 'approved' OR COALESCE(is_available, false) = false
      ),
      'total_services', (SELECT count(*)::integer FROM scoped_services),
      'live_services', (
        SELECT count(*)::integer FROM scoped_services
        WHERE approval_status = 'approved' AND COALESCE(is_available, false)
      ),
      'pending_services', (
        SELECT count(*)::integer FROM scoped_services WHERE approval_status = 'pending'
      )
    ),
    'orders', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_orders),
      'today', (SELECT count(*)::integer FROM scoped_orders WHERE created_at >= v_today_start),
      'week', (SELECT count(*)::integer FROM scoped_orders WHERE created_at >= v_week_start),
      'month', (SELECT count(*)::integer FROM scoped_orders WHERE created_at >= v_month_start),
      'payment_pending', (
        SELECT count(*)::integer FROM scoped_orders
        WHERE payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
      ),
      'disputed', (
        SELECT count(DISTINCT o.id)::integer FROM scoped_orders o
        WHERE EXISTS (SELECT 1 FROM scoped_disputes d WHERE d.order_id = o.id)
           OR EXISTS (SELECT 1 FROM scoped_dispute_tickets dt WHERE dt.order_id = o.id)
      ),
      'by_status', COALESCE((
        SELECT jsonb_agg(to_jsonb(order_status_rows) ORDER BY count DESC) FROM order_status_rows
      ), '[]'::jsonb)
    ),
    'bookings', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM scoped_bookings),
      'by_status', COALESCE((
        SELECT jsonb_agg(to_jsonb(booking_status_rows) ORDER BY count DESC) FROM booking_status_rows
      ), '[]'::jsonb)
    ),
    'enquiries', jsonb_build_object(
      'total', (
        SELECT count(*)::integer FROM scoped_orders
        WHERE order_type = 'enquiry' OR status::text IN ('enquired', 'quoted')
      ),
      'open', (
        SELECT count(*)::integer FROM scoped_orders WHERE status::text IN ('enquired', 'quoted')
      ),
      'new', (
        SELECT count(*)::integer FROM scoped_orders WHERE status::text = 'enquired'
      ),
      'responded', (
        SELECT count(*)::integer FROM scoped_orders WHERE status::text = 'quoted'
      ),
      'unanswered', (
        SELECT count(*)::integer FROM scoped_orders o
        WHERE o.status::text = 'enquired'
          AND NOT EXISTS (
            SELECT 1 FROM public.seller_contact_interactions sci
            WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
          )
      ),
      'closed', (
        SELECT count(*)::integer FROM scoped_orders
        WHERE order_type = 'enquiry' AND status::text IN ('placed', 'delivered', 'cancelled')
      )
    ),
    'disputes', jsonb_build_object(
      'open', (
        SELECT (
          (SELECT count(*)::integer FROM scoped_dispute_tickets WHERE status NOT IN ('resolved', 'closed'))
          + (SELECT count(*)::integer FROM scoped_disputes WHERE status NOT IN ('resolved', 'closed', 'rejected'))
        )
      ),
      'total', (
        SELECT (
          (SELECT count(*)::integer FROM scoped_dispute_tickets)
          + (SELECT count(*)::integer FROM scoped_disputes)
        )
      ),
      'under_review', (
        SELECT count(*)::integer FROM scoped_dispute_tickets WHERE status IN ('acknowledged', 'in_review')
      ),
      'resolved', (
        SELECT (
          (SELECT count(*)::integer FROM scoped_dispute_tickets WHERE status IN ('resolved', 'closed'))
          + (SELECT count(*)::integer FROM scoped_disputes WHERE status = 'resolved')
        )
      )
    ),
    'refunds', jsonb_build_object(
      'open', (
        SELECT count(*)::integer FROM scoped_refunds
        WHERE refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
      )
    ),
    'attention', jsonb_build_object(
      'pending_store_verifications', (
        SELECT count(*)::integer FROM scoped_sellers WHERE verification_status::text = 'pending'
      ),
      'pending_product_approvals', (
        SELECT count(*)::integer FROM scoped_products WHERE approval_status = 'pending'
      ),
      'open_disputes', (
        SELECT (
          (SELECT count(*)::integer FROM scoped_dispute_tickets WHERE status NOT IN ('resolved', 'closed'))
          + (SELECT count(*)::integer FROM scoped_disputes WHERE status NOT IN ('resolved', 'closed', 'rejected'))
        )
      ),
      'open_refunds', (
        SELECT count(*)::integer FROM scoped_refunds
        WHERE refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
      ),
      'payment_pending_orders', (
        SELECT count(*)::integer FROM scoped_orders
        WHERE payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
      ),
      'unanswered_enquiries', (
        SELECT count(*)::integer FROM scoped_orders o
        WHERE o.status::text = 'enquired'
          AND NOT EXISTS (
            SELECT 1 FROM public.seller_contact_interactions sci
            WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
          )
      )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── Store / Seller 360 ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_store_360(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  SELECT jsonb_build_object(
    'seller_id', sp.id,
    'business_name', sp.business_name,
    'description', sp.description,
    'verification_status', sp.verification_status,
    'is_available', COALESCE(sp.is_available, false),
    'vacation_mode', COALESCE(sp.vacation_mode, false),
    'society_id', sp.society_id,
    'society_name', soc.name,
    'owner_name', pr.name,
    'owner_phone', pr.phone,
    'owner_email', pr.email,
    'created_at', sp.created_at,
    'last_active_at', sp.last_active_at,
    'categories', sp.categories,
    'fulfillment_mode', sp.fulfillment_mode,
    'delivery_radius_km', sp.delivery_radius_km,
    'latitude', sp.latitude,
    'longitude', sp.longitude,
    'rating', sp.rating,
    'total_reviews', sp.total_reviews,
    'completed_order_count', sp.completed_order_count,
    'cancellation_rate', sp.cancellation_rate,
    'reliability_score', sp.reliability_score,
    'avg_response_minutes', sp.avg_response_minutes,
    'activity', jsonb_build_object(
      'orders_total', (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id),
      'orders_30d', (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.created_at >= now() - interval '30 days'),
      'orders_completed', (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.status::text IN ('delivered', 'completed')),
      'orders_cancelled', (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.status::text = 'cancelled'),
      'bookings_total', (SELECT count(*)::integer FROM public.service_bookings sb WHERE sb.seller_id = sp.id),
      'bookings_completed', (SELECT count(*)::integer FROM public.service_bookings sb WHERE sb.seller_id = sp.id AND sb.status = 'completed'),
      'enquiries_total', (
        SELECT count(*)::integer FROM public.orders o
        WHERE o.seller_id = sp.id AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
      ),
      'enquiries_unanswered', (
        SELECT count(*)::integer FROM public.orders o
        WHERE o.seller_id = sp.id AND o.status::text = 'enquired'
          AND NOT EXISTS (
            SELECT 1 FROM public.seller_contact_interactions sci
            WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
          )
      )
    ),
    'listings', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id),
      'live', (
        SELECT count(*)::integer FROM public.products p
        WHERE p.seller_id = sp.id AND p.approval_status = 'approved' AND COALESCE(p.is_available, false)
      ),
      'pending', (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id AND p.approval_status = 'pending'),
      'services', (
        SELECT count(*)::integer FROM public.products p
        WHERE p.seller_id = sp.id
          AND EXISTS (SELECT 1 FROM public.service_listings sl WHERE sl.product_id = p.id)
      )
    ),
    'quality', jsonb_build_object(
      'open_disputes', (
        SELECT (
          (SELECT count(*)::integer FROM public.dispute_tickets dt
           JOIN public.orders o ON o.id = dt.order_id WHERE o.seller_id = sp.id AND dt.status NOT IN ('resolved', 'closed'))
          + (SELECT count(*)::integer FROM public.disputes d WHERE d.seller_id = sp.id AND d.status NOT IN ('resolved', 'closed', 'rejected'))
        )
      ),
      'open_refunds', (
        SELECT count(*)::integer FROM public.refund_requests rr
        JOIN public.orders o ON o.id = rr.order_id
        WHERE o.seller_id = sp.id
          AND rr.refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
      ),
      'avg_review_rating', (
        SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r
        WHERE r.seller_id = sp.id AND COALESCE(r.is_hidden, false) = false
      ),
      'review_count', (
        SELECT count(*)::integer FROM public.reviews r
        WHERE r.seller_id = sp.id AND COALESCE(r.is_hidden, false) = false
      )
    ),
    'recent_orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT o.id AS order_id, o.status, o.total_amount, o.created_at, bp.name AS buyer_name
        FROM public.orders o
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        WHERE o.seller_id = sp.id
        ORDER BY o.created_at DESC LIMIT 10
      ) x
    ), '[]'::jsonb),
    'recent_products', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT p.id AS product_id, p.name, p.approval_status, p.is_available, p.price, p.category
        FROM public.products p WHERE p.seller_id = sp.id
        ORDER BY p.updated_at DESC NULLS LAST LIMIT 10
      ) x
    ), '[]'::jsonb),
    'recent_reviews', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT r.id AS review_id, r.rating, r.comment, r.created_at, bp.name AS buyer_name
        FROM public.reviews r
        LEFT JOIN public.profiles bp ON bp.id = r.buyer_id
        WHERE r.seller_id = sp.id AND COALESCE(r.is_hidden, false) = false
        ORDER BY r.created_at DESC LIMIT 5
      ) x
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.seller_profiles sp
  LEFT JOIN public.profiles pr ON pr.id = sp.user_id
  LEFT JOIN public.societies soc ON soc.id = sp.society_id
  WHERE sp.id = p_seller_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'store not found';
  END IF;

  RETURN v_result;
END;
$$;

-- ── Disputes list (order disputes + society tickets) ─────────────────────────
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
          AND (p_status IS NULL OR btrim(p_status) = '' OR d.status = p_status)
          AND (p_seller_id IS NULL OR d.seller_id = p_seller_id)
          AND (p_from IS NULL OR d.created_at >= p_from)
          AND (p_to IS NULL OR d.created_at < p_to)
          AND (p_search IS NULL OR btrim(p_search) = '' OR d.id::text ILIKE '%' || btrim(p_search) || '%' OR sp.business_name ILIKE '%' || btrim(p_search) || '%')
        UNION ALL
        SELECT dt.id FROM public.dispute_tickets dt
        JOIN public.orders o ON o.id = dt.order_id
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        WHERE (p_society_id IS NULL OR dt.society_id = p_society_id)
          AND (p_status IS NULL OR btrim(p_status) = '' OR dt.status = p_status)
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
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
          WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
            AND (p_status IS NULL OR btrim(p_status) = '' OR d.status = p_status)
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
            AND (p_status IS NULL OR btrim(p_status) = '' OR dt.status = p_status)
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

-- ── Activity timeline ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_activity_timeline(
  p_society_id uuid DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
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
      SELECT count(*)::integer FROM (
        SELECT o.id FROM public.orders o
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
          AND (p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('order_placed', 'all', ''))
        UNION ALL
        SELECT sp.id FROM public.seller_profiles sp
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_seller_id IS NULL OR sp.id = p_seller_id)
          AND (p_from IS NULL OR sp.created_at >= p_from) AND (p_to IS NULL OR sp.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('store_registered', 'all', ''))
        UNION ALL
        SELECT p.id FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_seller_id IS NULL OR p.seller_id = p_seller_id)
          AND (p_from IS NULL OR p.created_at >= p_from) AND (p_to IS NULL OR p.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('product_listed', 'all', ''))
        UNION ALL
        SELECT sb.id FROM public.service_bookings sb
        JOIN public.seller_profiles sp ON sp.id = sb.seller_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_seller_id IS NULL OR sb.seller_id = p_seller_id)
          AND (p_from IS NULL OR sb.created_at >= p_from) AND (p_to IS NULL OR sb.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('booking_created', 'all', ''))
        UNION ALL
        SELECT d.id FROM public.disputes d
        WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
          AND (p_seller_id IS NULL OR d.seller_id = p_seller_id)
          AND (p_from IS NULL OR d.created_at >= p_from) AND (p_to IS NULL OR d.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('dispute_raised', 'all', ''))
        UNION ALL
        SELECT r.id FROM public.reviews r
        JOIN public.seller_profiles sp ON sp.id = r.seller_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_seller_id IS NULL OR r.seller_id = p_seller_id)
          AND (p_from IS NULL OR r.created_at >= p_from) AND (p_to IS NULL OR r.created_at < p_to)
          AND (p_event_type IS NULL OR p_event_type IN ('review_posted', 'all', ''))
      ) c
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at DESC)
      FROM (
        SELECT * FROM (
          SELECT 'order_placed' AS event_type, o.id AS entity_id, o.created_at AS occurred_at,
            sp.business_name AS actor_name, bp.name AS target_name,
            o.status::text AS detail, o.seller_id, o.total_amount AS amount
          FROM public.orders o
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
          WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
            AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
            AND (p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'order_placed')
          UNION ALL
          SELECT 'store_registered', sp.id, sp.created_at, sp.business_name, pr.name,
            sp.verification_status::text, sp.id, NULL::numeric
          FROM public.seller_profiles sp
          LEFT JOIN public.profiles pr ON pr.id = sp.user_id
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND (p_seller_id IS NULL OR sp.id = p_seller_id)
            AND (p_from IS NULL OR sp.created_at >= p_from) AND (p_to IS NULL OR sp.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'store_registered')
          UNION ALL
          SELECT 'product_listed', p.id, p.created_at, sp.business_name, p.name,
            p.approval_status::text, p.seller_id, p.price
          FROM public.products p
          JOIN public.seller_profiles sp ON sp.id = p.seller_id
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND (p_seller_id IS NULL OR p.seller_id = p_seller_id)
            AND (p_from IS NULL OR p.created_at >= p_from) AND (p_to IS NULL OR p.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'product_listed')
          UNION ALL
          SELECT 'booking_created', sb.id, sb.created_at, sp.business_name, bp.name,
            sb.status, sb.seller_id, NULL::numeric
          FROM public.service_bookings sb
          JOIN public.seller_profiles sp ON sp.id = sb.seller_id
          LEFT JOIN public.profiles bp ON bp.id = sb.buyer_id
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND (p_seller_id IS NULL OR sb.seller_id = p_seller_id)
            AND (p_from IS NULL OR sb.created_at >= p_from) AND (p_to IS NULL OR sb.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'booking_created')
          UNION ALL
          SELECT 'dispute_raised', d.id, d.created_at, sp.business_name, bp.name,
            d.status, d.seller_id, NULL::numeric
          FROM public.disputes d
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
          WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
            AND (p_seller_id IS NULL OR d.seller_id = p_seller_id)
            AND (p_from IS NULL OR d.created_at >= p_from) AND (p_to IS NULL OR d.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'dispute_raised')
          UNION ALL
          SELECT 'review_posted', r.id, r.created_at, sp.business_name, bp.name,
            r.rating::text, r.seller_id, NULL::numeric
          FROM public.reviews r
          JOIN public.seller_profiles sp ON sp.id = r.seller_id
          LEFT JOIN public.profiles bp ON bp.id = r.buyer_id
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND (p_seller_id IS NULL OR r.seller_id = p_seller_id)
            AND (p_from IS NULL OR r.created_at >= p_from) AND (p_to IS NULL OR r.created_at < p_to)
            AND (p_event_type IS NULL OR btrim(p_event_type) = '' OR p_event_type = 'review_posted')
        ) events
        ORDER BY occurred_at DESC
        LIMIT v_limit OFFSET v_offset
      ) ev
    ), '[]'::jsonb)
  );
END;
$$;

-- ── Global search ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_global_search(
  p_query text,
  p_society_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q text := btrim(COALESCE(p_query, ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF v_q = '' THEN
    RETURN jsonb_build_object('sellers', '[]'::jsonb, 'products', '[]'::jsonb, 'orders', '[]'::jsonb, 'bookings', '[]'::jsonb, 'enquiries', '[]'::jsonb, 'disputes', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'sellers', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT sp.id AS seller_id, sp.business_name AS name, sp.verification_status AS status, 'store' AS kind
        FROM public.seller_profiles sp
        LEFT JOIN public.profiles pr ON pr.id = sp.user_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (sp.business_name ILIKE '%' || v_q || '%' OR sp.id::text ILIKE '%' || v_q || '%' OR pr.phone ILIKE '%' || v_q || '%' OR pr.name ILIKE '%' || v_q || '%')
        ORDER BY sp.created_at DESC LIMIT v_limit
      ) x
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT p.id AS product_id, p.name, p.category, p.approval_status AS status, sp.business_name AS seller_name, p.seller_id
        FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p.name ILIKE '%' || v_q || '%' OR p.id::text ILIKE '%' || v_q || '%' OR p.category ILIKE '%' || v_q || '%')
        ORDER BY p.updated_at DESC NULLS LAST LIMIT v_limit
      ) x
    ), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT o.id AS order_id, o.status, o.total_amount, sp.business_name AS seller_name, bp.name AS buyer_name, o.seller_id
        FROM public.orders o
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (o.id::text ILIKE '%' || v_q || '%' OR bp.name ILIKE '%' || v_q || '%' OR sp.business_name ILIKE '%' || v_q || '%')
        ORDER BY o.created_at DESC LIMIT v_limit
      ) x
    ), '[]'::jsonb),
    'bookings', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT sb.id AS booking_id, sb.status, sp.business_name AS seller_name, p.name AS product_name, sb.seller_id
        FROM public.service_bookings sb
        JOIN public.seller_profiles sp ON sp.id = sb.seller_id
        LEFT JOIN public.products p ON p.id = sb.product_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (sb.id::text ILIKE '%' || v_q || '%' OR sp.business_name ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%')
        ORDER BY sb.created_at DESC LIMIT v_limit
      ) x
    ), '[]'::jsonb),
    'enquiries', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT o.id AS enquiry_id, o.status, sp.business_name AS seller_name, bp.name AS buyer_name, o.seller_id
        FROM public.orders o
        LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
        LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
        WHERE (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
          AND (o.id::text ILIKE '%' || v_q || '%' OR bp.name ILIKE '%' || v_q || '%' OR sp.business_name ILIKE '%' || v_q || '%')
        ORDER BY o.created_at DESC LIMIT v_limit
      ) x
    ), '[]'::jsonb),
    'disputes', COALESCE((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT * FROM (
          SELECT d.id AS dispute_id, d.status, 'order_dispute' AS dispute_kind, sp.business_name AS seller_name, d.seller_id, d.order_id
          FROM public.disputes d
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
            AND d.id::text ILIKE '%' || v_q || '%'
          UNION ALL
          SELECT dt.id, dt.status, 'society_ticket', sp.business_name, o.seller_id, dt.order_id
          FROM public.dispute_tickets dt
          JOIN public.orders o ON o.id = dt.order_id
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          WHERE (p_society_id IS NULL OR dt.society_id = p_society_id)
            AND (dt.id::text ILIKE '%' || v_q || '%' OR dt.category ILIKE '%' || v_q || '%')
        ) u LIMIT v_limit
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ── Category intelligence ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_category_intelligence(
  p_society_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  IF p_subcategory_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'subcategory',
      'category', p_category,
      'subcategory_id', p_subcategory_id,
      'subcategory_name', (SELECT name FROM public.subcategories WHERE id = p_subcategory_id),
      'sellers', COALESCE((
        SELECT jsonb_agg(to_jsonb(x))
        FROM (
          SELECT sp.id AS seller_id, sp.business_name,
            (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id AND p.subcategory_id = p_subcategory_id) AS product_count,
            (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.created_at >= now() - interval '30 days') AS orders_30d
          FROM public.seller_profiles sp
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id = sp.id AND p.subcategory_id = p_subcategory_id)
          ORDER BY product_count DESC
        ) x
      ), '[]'::jsonb),
      'products', COALESCE((
        SELECT jsonb_agg(to_jsonb(x))
        FROM (
          SELECT p.id AS product_id, p.name, p.price, p.approval_status, p.is_available, sp.business_name AS seller_name, p.seller_id
          FROM public.products p
          JOIN public.seller_profiles sp ON sp.id = p.seller_id
          WHERE p.subcategory_id = p_subcategory_id
            AND (p_society_id IS NULL OR sp.society_id = p_society_id)
          ORDER BY p.updated_at DESC NULLS LAST LIMIT 50
        ) x
      ), '[]'::jsonb)
    );
  END IF;

  IF p_category IS NOT NULL AND btrim(p_category) <> '' THEN
    RETURN jsonb_build_object(
      'level', 'category',
      'category', p_category,
      'subcategories', COALESCE((
        SELECT jsonb_agg(to_jsonb(x))
        FROM (
          SELECT sc.id AS subcategory_id, sc.name AS subcategory_name,
            (SELECT count(DISTINCT p.seller_id)::integer FROM public.products p
             JOIN public.seller_profiles sp ON sp.id = p.seller_id
             WHERE p.subcategory_id = sc.id AND (p_society_id IS NULL OR sp.society_id = p_society_id)) AS seller_count,
            (SELECT count(*)::integer FROM public.products p
             JOIN public.seller_profiles sp ON sp.id = p.seller_id
             WHERE p.subcategory_id = sc.id AND (p_society_id IS NULL OR sp.society_id = p_society_id)) AS product_count
          FROM public.subcategories sc
          WHERE sc.category = p_category OR sc.id IN (
            SELECT DISTINCT p.subcategory_id FROM public.products p
            JOIN public.seller_profiles sp ON sp.id = p.seller_id
            WHERE p.category = p_category AND p.subcategory_id IS NOT NULL
              AND (p_society_id IS NULL OR sp.society_id = p_society_id)
          )
          ORDER BY product_count DESC
        ) x
      ), '[]'::jsonb),
      'sellers', COALESCE((
        SELECT jsonb_agg(to_jsonb(x))
        FROM (
          SELECT sp.id AS seller_id, sp.business_name,
            (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id AND p.category = p_category) AS product_count,
            (SELECT count(*)::integer FROM public.orders o
             JOIN public.order_items oi ON oi.order_id = o.id
             JOIN public.products p ON p.id = oi.product_id
             WHERE o.seller_id = sp.id AND p.category = p_category AND o.created_at >= now() - interval '30 days') AS orders_30d
          FROM public.seller_profiles sp
          WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
            AND (p_category = ANY(sp.categories) OR EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id = sp.id AND p.category = p_category))
          ORDER BY orders_30d DESC
        ) x
      ), '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'level', 'root',
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT cat.category,
          cat.seller_count,
          cat.product_count,
          cat.live_count,
          COALESCE(ord.orders_30d, 0) AS orders_30d
        FROM (
          SELECT p.category,
            count(DISTINCT p.seller_id)::integer AS seller_count,
            count(*)::integer AS product_count,
            count(*) FILTER (WHERE p.approval_status = 'approved' AND COALESCE(p.is_available, false))::integer AS live_count
          FROM public.products p
          JOIN public.seller_profiles sp ON sp.id = p.seller_id
          WHERE p.category IS NOT NULL AND btrim(p.category) <> ''
            AND (p_society_id IS NULL OR sp.society_id = p_society_id)
          GROUP BY p.category
        ) cat
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT o.id)::integer AS orders_30d
          FROM public.orders o
          JOIN public.order_items oi ON oi.order_id = o.id
          JOIN public.products p ON p.id = oi.product_id
          WHERE p.category = cat.category
            AND o.created_at >= now() - interval '30 days'
            AND (p_society_id IS NULL OR o.society_id = p_society_id)
        ) ord ON true
        ORDER BY orders_30d DESC, product_count DESC
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ── Enriched orders list ──────────────────────────────────────────────────────
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
          AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
          AND (p_payment_status IS NULL OR btrim(p_payment_status) = '' OR o.payment_status::text = p_payment_status)
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

-- ── Enriched enquiries list ───────────────────────────────────────────────────
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
          AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
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

-- ── Enriched sellers list (rating + draft/suspended visible) ────────────────
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
      WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
        AND (p_verification_status IS NULL OR btrim(p_verification_status) = '' OR sp.verification_status::text = p_verification_status)
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
          (SELECT count(*)::integer FROM public.orders o WHERE o.seller_id = sp.id AND o.status::text = 'enquired'
            AND NOT EXISTS (SELECT 1 FROM public.seller_contact_interactions sci WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed'))) AS unanswered_enquiries
        FROM public.seller_profiles sp
        LEFT JOIN public.profiles pr ON pr.id = sp.user_id
        LEFT JOIN public.societies soc ON soc.id = sp.society_id
        WHERE (p_society_id IS NULL OR sp.society_id = p_society_id)
          AND (p_verification_status IS NULL OR btrim(p_verification_status) = '' OR sp.verification_status::text = p_verification_status)
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

REVOKE ALL ON FUNCTION public.admin_get_store_360(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_disputes_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_activity_timeline(uuid, text, uuid, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_global_search(text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_category_intelligence(uuid, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_store_360(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_disputes_filtered(uuid, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_activity_timeline(uuid, text, uuid, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_global_search(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_category_intelligence(uuid, text, uuid) TO authenticated;
