-- ============================================================
-- P0/P1: License approval integrity + refund idempotency + refund notifs
-- ============================================================

-- 1) Authoritative license gate for seller_profiles → approved
CREATE OR REPLACE FUNCTION public.seller_mandatory_license_ok(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_primary text;
  v_requires boolean := false;
  v_mandatory boolean := false;
  v_type_name text := 'required license';
  v_has_approved boolean := false;
  v_has_pending boolean := false;
  v_has_rejected boolean := false;
  v_has_expired_only boolean := false;
BEGIN
  SELECT sp.primary_group INTO v_primary
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;

  IF v_primary IS NULL OR btrim(v_primary) = '' THEN
    RETURN 'ok';
  END IF;

  SELECT
    COALESCE(bool_or(pg.requires_license), false)
      OR COALESCE(bool_or(cc.requires_license), false),
    COALESCE(bool_or(pg.license_mandatory), false)
      OR COALESCE(bool_or(cc.requires_license AND cc.license_mandatory), false),
    COALESCE(
      max(NULLIF(pg.license_type_name, '')),
      max(NULLIF(cc.license_type_name, '')),
      'required license'
    )
  INTO v_requires, v_mandatory, v_type_name
  FROM public.parent_groups pg
  LEFT JOIN public.category_config cc ON cc.parent_group = pg.slug
  WHERE pg.slug = v_primary;

  IF NOT COALESCE(v_requires, false) OR NOT COALESCE(v_mandatory, false) THEN
    RETURN 'ok';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.seller_licenses sl
      WHERE sl.seller_id = p_seller_id
        AND sl.status = 'approved'
        AND (sl.expires_at IS NULL OR sl.expires_at > now())
    ),
    EXISTS (
      SELECT 1 FROM public.seller_licenses sl
      WHERE sl.seller_id = p_seller_id
        AND sl.status = 'pending'
        AND (sl.expires_at IS NULL OR sl.expires_at > now())
    ),
    EXISTS (
      SELECT 1 FROM public.seller_licenses sl
      WHERE sl.seller_id = p_seller_id AND sl.status = 'rejected'
    ),
    (
      EXISTS (SELECT 1 FROM public.seller_licenses sl WHERE sl.seller_id = p_seller_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.seller_licenses sl
        WHERE sl.seller_id = p_seller_id
          AND sl.status IN ('approved', 'pending')
          AND (sl.expires_at IS NULL OR sl.expires_at > now())
      )
      AND EXISTS (
        SELECT 1 FROM public.seller_licenses sl
        WHERE sl.seller_id = p_seller_id
          AND sl.status = 'approved'
          AND sl.expires_at IS NOT NULL
          AND sl.expires_at <= now()
      )
    )
  INTO v_has_approved, v_has_pending, v_has_rejected, v_has_expired_only;

  IF v_has_approved THEN
    RETURN 'ok';
  END IF;
  IF v_has_pending THEN
    -- Pending is only acceptable mid-admin-approval after licenses are flipped;
    -- for the BEFORE trigger we require approved. Callers that auto-approve
    -- pending licenses must do so before setting verification_status=approved.
    RETURN 'pending:' || v_type_name;
  END IF;
  IF v_has_expired_only THEN
    RETURN 'expired:' || v_type_name;
  END IF;
  IF v_has_rejected THEN
    RETURN 'rejected:' || v_type_name;
  END IF;
  RETURN 'missing:' || v_type_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_seller_approval_requires_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gate text;
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status = 'approved' THEN
    v_gate := public.seller_mandatory_license_ok(NEW.id);
    -- Allow pending only when this statement is part of admin approval that
    -- already promoted licenses; strict gate requires approved.
    IF v_gate IS DISTINCT FROM 'ok' THEN
      IF v_gate LIKE 'missing:%' THEN
        RAISE EXCEPTION 'LICENSE_MISSING: Cannot approve store — mandatory % is missing',
          split_part(v_gate, ':', 2);
      ELSIF v_gate LIKE 'expired:%' THEN
        RAISE EXCEPTION 'LICENSE_EXPIRED: Cannot approve store — mandatory % is expired',
          split_part(v_gate, ':', 2);
      ELSIF v_gate LIKE 'rejected:%' THEN
        RAISE EXCEPTION 'LICENSE_REJECTED: Cannot approve store — mandatory % was rejected',
          split_part(v_gate, ':', 2);
      ELSIF v_gate LIKE 'pending:%' THEN
        RAISE EXCEPTION 'LICENSE_NOT_VERIFIED: Cannot approve store — mandatory % is still pending verification',
          split_part(v_gate, ':', 2);
      ELSE
        RAISE EXCEPTION 'LICENSE_INVALID: Cannot approve store — license requirement not met (% )', v_gate;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_seller_approval_requires_license ON public.seller_profiles;
CREATE TRIGGER trg_guard_seller_approval_requires_license
  BEFORE UPDATE OF verification_status ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_seller_approval_requires_license();

-- 2) One active refund per order (race-safe)
-- Collapse any historical duplicate actives before unique index
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY order_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.refund_requests
  WHERE refund_state NOT IN ('rejected', 'refund_completed')
)
UPDATE public.refund_requests rr
SET refund_state = 'rejected',
    status = 'rejected',
    rejection_reason = COALESCE(rr.rejection_reason, 'Superseded duplicate active refund (integrity migration)')
FROM ranked
WHERE rr.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_refund_per_order
  ON public.refund_requests (order_id)
  WHERE refund_state NOT IN ('rejected', 'refund_completed');

-- 3) Idempotent request_refund + correct notification type (not order lifecycle)
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'original_payment'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_existing uuid;
  v_seller_user uuid;
  v_dest text;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  v_dest := lower(COALESCE(NULLIF(trim(p_refund_destination), ''), 'original_payment'));
  IF v_dest NOT IN ('original_payment', 'wallet') THEN
    RAISE EXCEPTION 'Invalid refund destination: %', v_dest;
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  -- Idempotent: return existing active refund instead of creating a duplicate
  SELECT id INTO v_existing
  FROM refund_requests
  WHERE order_id = p_order_id
    AND refund_state NOT IN ('rejected', 'refund_completed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_dest = 'original_payment'
     AND lower(COALESCE(v_order.payment_type, '')) IN ('cod', 'cash') THEN
    v_dest := 'wallet';
  END IF;

  BEGIN
    INSERT INTO refund_requests (
      order_id, buyer_id, seller_id, society_id, amount, reason, category,
      evidence_urls, refund_method, refund_destination, wallet_credit_amount,
      status, refund_state
    )
    VALUES (
      p_order_id,
      v_order.buyer_id,
      v_order.seller_id,
      v_order.society_id,
      COALESCE(
        NULLIF(v_order.frozen_total, 0),
        COALESCE(v_order.total_amount, 0)
          + COALESCE(v_order.wallet_cash_amount, 0)
          + COALESCE(v_order.wallet_promo_amount, 0)
      ),
      p_reason,
      p_category,
      p_evidence_urls,
      CASE WHEN v_dest = 'wallet' THEN 'wallet' ELSE 'original_payment' END,
      v_dest,
      CASE WHEN v_dest = 'wallet' THEN COALESCE(
        NULLIF(v_order.frozen_total, 0),
        COALESCE(v_order.total_amount, 0)
          + COALESCE(v_order.wallet_cash_amount, 0)
          + COALESCE(v_order.wallet_promo_amount, 0)
      ) ELSE NULL END,
      'requested',
      'requested'
    )
    RETURNING id INTO v_refund_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_refund_id
      FROM refund_requests
      WHERE order_id = p_order_id
        AND refund_state NOT IN ('rejected', 'refund_completed')
      ORDER BY created_at DESC
      LIMIT 1;
      IF v_refund_id IS NULL THEN
        RAISE;
      END IF;
      RETURN v_refund_id;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dispute_tickets
    WHERE order_id = p_order_id AND status != 'resolved'
  ) THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (
      p_order_id,
      auth.uid(),
      (SELECT sp.user_id FROM seller_profiles sp WHERE sp.id = v_order.seller_id),
      p_reason,
      p_category,
      'open',
      v_order.society_id
    );
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_seller_user,
      'Refund requested',
      'A buyer requested a refund. Reason: ' || left(coalesce(p_reason, ''), 120),
      'refund_request',
      '/seller?tab=refunds&refundId=' || v_refund_id::text,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- Heal existing refund notifications incorrectly marked read due to order-state guard
UPDATE public.user_notifications un
SET is_read = false
WHERE un.title = 'Refund requested'
  AND un.is_read = true
  AND COALESCE(un.data->>'status', un.payload->>'status', '') IN ('refund_requested', 'refund_request')
  AND COALESCE(un.data->>'target_role', un.payload->>'target_role', '') = 'seller'
  AND un.created_at > now() - interval '30 days';
