-- Admin Command Center ops console (staging only - do not apply to production yet).
-- Patches filtered list RPCs for open/pending_any semantics and adds attention queue,
-- growth snapshot, and reports list helpers.

-- ── 1) Patch admin_list_disputes_filtered ─────────────────────────────────────
-- When p_status = 'open', match statuses NOT IN ('resolved','closed','rejected')
-- for both disputes and dispute_tickets. Exact match for other status values.
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
            OR (v_status = 'open' AND d.status NOT IN ('resolved', 'closed', 'rejected'))
            OR (v_status IS DISTINCT FROM 'open' AND d.status = v_status)
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
            OR (v_status = 'open' AND dt.status NOT IN ('resolved', 'closed', 'rejected'))
            OR (v_status IS DISTINCT FROM 'open' AND dt.status = v_status)
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
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
          WHERE (p_society_id IS NULL OR d.society_id = p_society_id)
            AND (
              v_status IS NULL
              OR (v_status = 'open' AND d.status NOT IN ('resolved', 'closed', 'rejected'))
              OR (v_status IS DISTINCT FROM 'open' AND d.status = v_status)
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
              OR (v_status = 'open' AND dt.status NOT IN ('resolved', 'closed', 'rejected'))
              OR (v_status IS DISTINCT FROM 'open' AND dt.status = v_status)
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

-- ── 2) Patch admin_list_enquiries_filtered ───────────────────────────────────
-- open → status IN ('enquired','quoted')
-- unanswered → status = 'enquired' AND no seller_contact_interactions responded/closed
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
          OR (
            v_status = 'unanswered'
            AND o.status::text = 'enquired'
            AND NOT EXISTS (
              SELECT 1 FROM public.seller_contact_interactions sci
              WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
            )
          )
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
            OR (
              v_status = 'unanswered'
              AND o.status::text = 'enquired'
              AND NOT EXISTS (
                SELECT 1 FROM public.seller_contact_interactions sci
                WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
              )
            )
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

-- ── 3) Patch admin_list_orders_filtered ──────────────────────────────────────
-- pending_any → payment_status IN ('pending','payment_pending','awaiting_payment')
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
        AND (p_status IS NULL OR btrim(p_status) = '' OR o.status::text = p_status)
        AND (
          v_payment_status IS NULL
          OR (
            v_payment_status = 'pending_any'
            AND o.payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
          )
          OR (
            v_payment_status IS DISTINCT FROM 'pending_any'
            AND o.payment_status::text = v_payment_status
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
          AND (
            v_payment_status IS NULL
            OR (
              v_payment_status = 'pending_any'
              AND o.payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
            )
            OR (
              v_payment_status IS DISTINCT FROM 'pending_any'
              AND o.payment_status::text = v_payment_status
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

-- ── 4) admin_list_attention_queue ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_attention_queue(
  p_society_id uuid,
  p_kinds text[] DEFAULT NULL,
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
        SELECT sp.id
        FROM public.seller_profiles sp
        WHERE (p_kinds IS NULL OR 'pending_store_verifications' = ANY(p_kinds))
          AND sp.verification_status::text = 'pending'
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
        UNION ALL
        SELECT p.id
        FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        WHERE (p_kinds IS NULL OR 'pending_product_approvals' = ANY(p_kinds))
          AND p.approval_status = 'pending'
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
        UNION ALL
        SELECT d.id
        FROM public.disputes d
        WHERE (p_kinds IS NULL OR 'open_disputes' = ANY(p_kinds))
          AND d.status NOT IN ('resolved', 'closed', 'rejected')
          AND (p_society_id IS NULL OR d.society_id = p_society_id)
        UNION ALL
        SELECT dt.id
        FROM public.dispute_tickets dt
        WHERE (p_kinds IS NULL OR 'open_disputes' = ANY(p_kinds))
          AND dt.status NOT IN ('resolved', 'closed', 'rejected')
          AND (p_society_id IS NULL OR dt.society_id = p_society_id)
        UNION ALL
        SELECT o.id
        FROM public.orders o
        WHERE (p_kinds IS NULL OR 'unanswered_enquiries' = ANY(p_kinds))
          AND o.status::text = 'enquired'
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.seller_contact_interactions sci
            WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
          )
        UNION ALL
        SELECT rr.id
        FROM public.refund_requests rr
        JOIN public.orders o ON o.id = rr.order_id
        WHERE (p_kinds IS NULL OR 'open_refunds' = ANY(p_kinds))
          AND rr.refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
        UNION ALL
        SELECT o.id
        FROM public.orders o
        WHERE (p_kinds IS NULL OR 'payment_pending_orders' = ANY(p_kinds))
          AND o.payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
      ) c
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT * FROM (
          SELECT
            'pending_store_verifications'::text AS kind,
            sp.id AS entity_id,
            'seller_profile'::text AS entity_type,
            sp.business_name AS title,
            'Store verification pending'::text AS subtitle,
            sp.verification_status::text AS status,
            sp.id AS seller_id,
            sp.business_name AS seller_name,
            sp.society_id,
            sp.created_at,
            4 AS priority
          FROM public.seller_profiles sp
          WHERE (p_kinds IS NULL OR 'pending_store_verifications' = ANY(p_kinds))
            AND sp.verification_status::text = 'pending'
            AND (p_society_id IS NULL OR sp.society_id = p_society_id)

          UNION ALL

          SELECT
            'pending_product_approvals',
            p.id,
            'product',
            p.name,
            COALESCE(sp.business_name, p.category::text, 'Product approval pending'),
            p.approval_status::text,
            p.seller_id,
            sp.business_name,
            sp.society_id,
            p.created_at,
            5
          FROM public.products p
          JOIN public.seller_profiles sp ON sp.id = p.seller_id
          WHERE (p_kinds IS NULL OR 'pending_product_approvals' = ANY(p_kinds))
            AND p.approval_status = 'pending'
            AND (p_society_id IS NULL OR sp.society_id = p_society_id)

          UNION ALL

          SELECT
            'open_disputes',
            d.id,
            'dispute',
            COALESCE(NULLIF(btrim(d.reason), ''), 'Open dispute'),
            'Order ' || d.order_id::text,
            d.status,
            d.seller_id,
            sp.business_name,
            d.society_id,
            d.created_at,
            3
          FROM public.disputes d
          LEFT JOIN public.seller_profiles sp ON sp.id = d.seller_id
          WHERE (p_kinds IS NULL OR 'open_disputes' = ANY(p_kinds))
            AND d.status NOT IN ('resolved', 'closed', 'rejected')
            AND (p_society_id IS NULL OR d.society_id = p_society_id)

          UNION ALL

          SELECT
            'open_disputes',
            dt.id,
            'dispute_ticket',
            COALESCE(NULLIF(btrim(dt.reason), ''), NULLIF(btrim(dt.category), ''), 'Open dispute ticket'),
            'Order ' || dt.order_id::text,
            dt.status,
            o.seller_id,
            sp.business_name,
            dt.society_id,
            dt.created_at,
            3
          FROM public.dispute_tickets dt
          JOIN public.orders o ON o.id = dt.order_id
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          WHERE (p_kinds IS NULL OR 'open_disputes' = ANY(p_kinds))
            AND dt.status NOT IN ('resolved', 'closed', 'rejected')
            AND (p_society_id IS NULL OR dt.society_id = p_society_id)

          UNION ALL

          SELECT
            'unanswered_enquiries',
            o.id,
            'order',
            COALESCE(
              (SELECT string_agg(DISTINCT oi.product_name, ', ')
               FROM public.order_items oi WHERE oi.order_id = o.id),
              'Unanswered enquiry'
            ),
            COALESCE(bp.name, 'Buyer enquiry'),
            o.status::text,
            o.seller_id,
            sp.business_name,
            o.society_id,
            o.created_at,
            6
          FROM public.orders o
          LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          WHERE (p_kinds IS NULL OR 'unanswered_enquiries' = ANY(p_kinds))
            AND o.status::text = 'enquired'
            AND (p_society_id IS NULL OR o.society_id = p_society_id)
            AND NOT EXISTS (
              SELECT 1 FROM public.seller_contact_interactions sci
              WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
            )

          UNION ALL

          SELECT
            'open_refunds',
            rr.id,
            'refund_request',
            COALESCE(NULLIF(btrim(rr.reason), ''), 'Open refund') || ' · ₹' || COALESCE(rr.amount, 0)::text,
            'Order ' || rr.order_id::text,
            rr.refund_state,
            COALESCE(rr.seller_id, o.seller_id),
            sp.business_name,
            o.society_id,
            rr.created_at,
            2
          FROM public.refund_requests rr
          JOIN public.orders o ON o.id = rr.order_id
          LEFT JOIN public.seller_profiles sp ON sp.id = COALESCE(rr.seller_id, o.seller_id)
          WHERE (p_kinds IS NULL OR 'open_refunds' = ANY(p_kinds))
            AND rr.refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
            AND (p_society_id IS NULL OR o.society_id = p_society_id)

          UNION ALL

          SELECT
            'payment_pending_orders',
            o.id,
            'order',
            'Payment pending · ₹' || COALESCE(o.total_amount, 0)::text,
            COALESCE(sp.business_name, o.payment_status::text),
            o.payment_status::text,
            o.seller_id,
            sp.business_name,
            o.society_id,
            o.created_at,
            1
          FROM public.orders o
          LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
          WHERE (p_kinds IS NULL OR 'payment_pending_orders' = ANY(p_kinds))
            AND o.payment_status::text IN ('pending', 'payment_pending', 'awaiting_payment')
            AND (p_society_id IS NULL OR o.society_id = p_society_id)
        ) combined
        ORDER BY priority ASC, created_at DESC
        LIMIT v_limit OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 5) admin_get_growth_snapshot ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_growth_snapshot(
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
  v_7d timestamptz := v_now - interval '7 days';
  v_30d timestamptz := v_now - interval '30 days';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'as_of', v_now,
    'society_id', p_society_id,
    'buyers', jsonb_build_object(
      'new_7d', (
        SELECT count(*)::integer
        FROM public.profiles pr
        WHERE pr.created_at >= v_7d
          AND (p_society_id IS NULL OR pr.society_id = p_society_id)
      ),
      'new_30d', (
        SELECT count(*)::integer
        FROM public.profiles pr
        WHERE pr.created_at >= v_30d
          AND (p_society_id IS NULL OR pr.society_id = p_society_id)
      ),
      'with_order_7d', (
        SELECT count(DISTINCT o.buyer_id)::integer
        FROM public.orders o
        WHERE o.created_at >= v_7d
          AND o.buyer_id IS NOT NULL
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
      ),
      'with_order_30d', (
        SELECT count(DISTINCT o.buyer_id)::integer
        FROM public.orders o
        WHERE o.created_at >= v_30d
          AND o.buyer_id IS NOT NULL
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
      )
    ),
    'sellers', jsonb_build_object(
      'new_7d', (
        SELECT count(*)::integer
        FROM public.seller_profiles sp
        WHERE sp.created_at >= v_7d
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      ),
      'new_30d', (
        SELECT count(*)::integer
        FROM public.seller_profiles sp
        WHERE sp.created_at >= v_30d
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      ),
      'pending', (
        SELECT count(*)::integer
        FROM public.seller_profiles sp
        WHERE sp.verification_status::text = 'pending'
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      ),
      'approved_7d', (
        SELECT count(*)::integer
        FROM public.seller_profiles sp
        WHERE sp.verification_status::text = 'approved'
          AND COALESCE(sp.updated_at, sp.created_at) >= v_7d
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      )
    ),
    'orders', jsonb_build_object(
      'placed_7d', (
        SELECT count(*)::integer
        FROM public.orders o
        WHERE o.created_at >= v_7d
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
      ),
      'placed_30d', (
        SELECT count(*)::integer
        FROM public.orders o
        WHERE o.created_at >= v_30d
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
      ),
      'gmv_30d', (
        SELECT COALESCE(SUM(o.total_amount), 0)
        FROM public.orders o
        WHERE o.created_at >= v_30d
          AND (p_society_id IS NULL OR o.society_id = p_society_id)
          AND (
            o.payment_status::text = 'paid'
            OR o.status::text IN ('completed', 'delivered')
          )
      )
    ),
    'listings', jsonb_build_object(
      'live', (
        SELECT count(*)::integer
        FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        WHERE p.approval_status = 'approved'
          AND COALESCE(p.is_available, false)
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      ),
      'pending', (
        SELECT count(*)::integer
        FROM public.products p
        JOIN public.seller_profiles sp ON sp.id = p.seller_id
        WHERE p.approval_status = 'pending'
          AND (p_society_id IS NULL OR sp.society_id = p_society_id)
      )
    )
  );
END;
$$;

-- ── 6) admin_list_reports_filtered ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_reports_filtered(
  p_society_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
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
      FROM public.reports r
      LEFT JOIN public.seller_profiles sp ON sp.id = r.reported_seller_id
      LEFT JOIN public.profiles reporter ON reporter.id = r.reporter_id
      WHERE (v_status IS NULL OR r.status = v_status)
        AND (
          p_society_id IS NULL
          OR sp.society_id = p_society_id
          OR reporter.society_id = p_society_id
        )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          r.id AS report_id,
          r.report_type,
          r.description,
          r.status,
          r.admin_notes,
          r.reporter_id,
          reporter.name AS reporter_name,
          r.reported_user_id,
          reported_user.name AS reported_user_name,
          r.reported_seller_id,
          sp.business_name AS reported_seller_name,
          sp.society_id AS seller_society_id,
          r.created_at,
          r.updated_at
        FROM public.reports r
        LEFT JOIN public.profiles reporter ON reporter.id = r.reporter_id
        LEFT JOIN public.profiles reported_user ON reported_user.id = r.reported_user_id
        LEFT JOIN public.seller_profiles sp ON sp.id = r.reported_seller_id
        WHERE (v_status IS NULL OR r.status = v_status)
          AND (
            p_society_id IS NULL
            OR sp.society_id = p_society_id
            OR reporter.society_id = p_society_id
          )
        ORDER BY r.created_at DESC
        LIMIT v_limit OFFSET v_offset
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_list_attention_queue(uuid, text[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_growth_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_reports_filtered(uuid, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_attention_queue(uuid, text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports_filtered(uuid, text, integer, integer) TO authenticated;
