-- Provider attempts are independent from order payment truth. A failed attempt
-- must never block or overwrite a later captured attempt.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  provider_order_id text,
  order_ids uuid[] NOT NULL CHECK (cardinality(order_ids) > 0),
  status text NOT NULL CHECK (
    status IN ('created', 'authorized', 'captured', 'failed', 'unknown')
  ),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
  currency text CHECK (currency IS NULL OR currency = upper(currency)),
  failure_code text,
  failure_description text,
  provider_created_at timestamptz,
  last_event_id text,
  payload_fingerprint text NOT NULL,
  captured_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_payment_id)
);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_attempts TO service_role;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_ids
  ON public.payment_attempts USING gin(order_ids);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_order
  ON public.payment_attempts(provider, provider_order_id);

CREATE OR REPLACE FUNCTION finance.register_payment_attempt_event(
  p_provider text,
  p_provider_payment_id text,
  p_provider_order_id text,
  p_order_ids uuid[],
  p_status text,
  p_amount_minor bigint,
  p_currency text,
  p_failure_code text,
  p_failure_description text,
  p_provider_created_at timestamptz,
  p_event_id text,
  p_payload_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_attempt public.payment_attempts%ROWTYPE;
  v_order_ids uuid[];
BEGIN
  IF p_provider_payment_id IS NULL OR btrim(p_provider_payment_id) = '' THEN
    RAISE EXCEPTION 'provider payment id is required';
  END IF;
  IF p_status NOT IN ('created', 'authorized', 'captured', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'unsupported payment attempt status: %', p_status;
  END IF;
  IF p_payload_fingerprint IS NULL OR length(p_payload_fingerprint) <> 64 THEN
    RAISE EXCEPTION 'SHA-256 payload fingerprint is required';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
  INTO v_order_ids
  FROM unnest(COALESCE(p_order_ids, '{}'::uuid[])) id;
  IF cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'payment attempt requires at least one order';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_order_ids) requested(id)
    LEFT JOIN public.orders o ON o.id = requested.id
    WHERE o.id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment attempt references an unknown order';
  END IF;

  SELECT * INTO v_attempt
  FROM public.payment_attempts
  WHERE provider = p_provider
    AND provider_payment_id = p_provider_payment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempt.provider_order_id IS DISTINCT FROM p_provider_order_id
       OR v_attempt.order_ids IS DISTINCT FROM v_order_ids
       OR (
         v_attempt.amount_minor IS NOT NULL
         AND p_amount_minor IS NOT NULL
         AND v_attempt.amount_minor <> p_amount_minor
       )
       OR (
         v_attempt.currency IS NOT NULL
         AND p_currency IS NOT NULL
         AND v_attempt.currency <> upper(p_currency)
       ) THEN
      RAISE EXCEPTION 'payment attempt identity or amount mismatch';
    END IF;
    IF v_attempt.status = 'captured' AND p_status <> 'captured' THEN
      RETURN jsonb_build_object(
        'ok', true, 'attempt_id', v_attempt.id,
        'status', v_attempt.status, 'ignored_stale_event', true
      );
    END IF;
    IF v_attempt.status = p_status
       AND v_attempt.payload_fingerprint = p_payload_fingerprint THEN
      RETURN jsonb_build_object(
        'ok', true, 'attempt_id', v_attempt.id,
        'status', v_attempt.status, 'deduplicated', true
      );
    END IF;

    UPDATE public.payment_attempts
    SET status = p_status,
        amount_minor = COALESCE(p_amount_minor, amount_minor),
        currency = COALESCE(upper(p_currency), currency),
        failure_code = CASE WHEN p_status = 'failed' THEN p_failure_code ELSE NULL END,
        failure_description = CASE
          WHEN p_status = 'failed' THEN left(p_failure_description, 1000)
          ELSE NULL
        END,
        provider_created_at = COALESCE(p_provider_created_at, provider_created_at),
        last_event_id = p_event_id,
        payload_fingerprint = p_payload_fingerprint,
        captured_at = CASE WHEN p_status = 'captured' THEN now() ELSE captured_at END,
        failed_at = CASE WHEN p_status = 'failed' THEN now() ELSE failed_at END,
        updated_at = now()
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.payment_attempts (
      provider, provider_payment_id, provider_order_id, order_ids, status,
      amount_minor, currency, failure_code, failure_description,
      provider_created_at, last_event_id, payload_fingerprint,
      captured_at, failed_at
    ) VALUES (
      p_provider, p_provider_payment_id, p_provider_order_id, v_order_ids, p_status,
      p_amount_minor, upper(p_currency),
      CASE WHEN p_status = 'failed' THEN p_failure_code END,
      CASE WHEN p_status = 'failed' THEN left(p_failure_description, 1000) END,
      p_provider_created_at, p_event_id, p_payload_fingerprint,
      CASE WHEN p_status = 'captured' THEN now() END,
      CASE WHEN p_status = 'failed' THEN now() END
    )
    RETURNING * INTO v_attempt;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt.id,
    'status', v_attempt.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_payment_attempt_event(
  p_provider text,
  p_provider_payment_id text,
  p_provider_order_id text,
  p_order_ids uuid[],
  p_status text,
  p_amount_minor bigint,
  p_currency text,
  p_failure_code text,
  p_failure_description text,
  p_provider_created_at timestamptz,
  p_event_id text,
  p_payload_fingerprint text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.register_payment_attempt_event(
    p_provider, p_provider_payment_id, p_provider_order_id, p_order_ids,
    p_status, p_amount_minor, p_currency, p_failure_code,
    p_failure_description, p_provider_created_at, p_event_id,
    p_payload_fingerprint
  );
$$;

REVOKE ALL ON FUNCTION public.register_payment_attempt_event(
  text, text, text, uuid[], text, bigint, text, text, text,
  timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_payment_attempt_event(
  text, text, text, uuid[], text, bigint, text, text, text,
  timestamptz, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION finance.confirm_captured_payment_group(
  p_order_ids uuid[],
  p_provider_payment_id text,
  p_provider_order_id text,
  p_amount_minor bigint,
  p_currency text,
  p_captured_at timestamptz,
  p_source text DEFAULT 'edge_confirm'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_order_ids uuid[];
  v_expected_minor bigint;
  v_capture public.payment_captures%ROWTYPE;
  v_commit jsonb;
  v_order record;
  v_allocated bigint := 0;
  v_order_count integer;
  v_index integer := 0;
  v_amount_minor bigint;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
  INTO v_order_ids
  FROM unnest(COALESCE(p_order_ids, '{}'::uuid[])) id;
  IF cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'captured payment requires orders';
  END IF;
  IF p_provider_order_id IS NULL OR btrim(p_provider_order_id) = '' THEN
    RAISE EXCEPTION 'captured payment requires provider order id';
  END IF;

  PERFORM 1
  FROM public.orders
  WHERE id = ANY(v_order_ids)
  ORDER BY id
  FOR SHARE;

  SELECT count(*), round(sum(total_amount) * 100)::bigint
  INTO v_order_count, v_expected_minor
  FROM public.orders
  WHERE id = ANY(v_order_ids);
  IF v_order_count <> cardinality(v_order_ids) THEN
    RAISE EXCEPTION 'captured payment references unknown orders';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = ANY(v_order_ids)
      AND razorpay_order_id IS DISTINCT FROM p_provider_order_id
  ) THEN
    RAISE EXCEPTION 'captured payment provider order binding mismatch';
  END IF;
  IF p_amount_minor IS NULL OR abs(v_expected_minor - p_amount_minor) > 1 THEN
    RAISE EXCEPTION
      'captured payment amount mismatch: expected %, provider %',
      v_expected_minor, p_amount_minor;
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'INR' THEN
    RAISE EXCEPTION 'captured payment currency mismatch';
  END IF;

  SELECT * INTO v_capture
  FROM public.payment_captures
  WHERE provider = 'razorpay'
    AND provider_payment_id = p_provider_payment_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_capture.provider_order_id IS DISTINCT FROM p_provider_order_id
       OR v_capture.amount_minor <> p_amount_minor
       OR v_capture.currency <> upper(p_currency) THEN
      RAISE EXCEPTION 'existing provider capture payload mismatch';
    END IF;
  ELSE
    INSERT INTO public.payment_captures (
      provider, provider_payment_id, provider_order_id, amount_minor,
      currency, status, captured_at
    ) VALUES (
      'razorpay', p_provider_payment_id, p_provider_order_id, p_amount_minor,
      upper(p_currency), 'captured', COALESCE(p_captured_at, now())
    )
    RETURNING * INTO v_capture;
  END IF;

  v_commit := public.confirm_orders_after_razorpay_payment(
    v_order_ids,
    p_provider_payment_id,
    p_provider_order_id,
    p_source
  );
  IF COALESCE((v_commit->>'success')::boolean, false) = false THEN
    RAISE EXCEPTION 'atomic order confirmation did not succeed: %', v_commit;
  END IF;

  DELETE FROM public.payment_capture_allocations
  WHERE capture_id = v_capture.id
    AND NOT (order_id = ANY(v_order_ids));

  FOR v_order IN
    SELECT id, seller_id, total_amount
    FROM public.orders
    WHERE id = ANY(v_order_ids)
    ORDER BY id
  LOOP
    v_index := v_index + 1;
    v_amount_minor := CASE
      WHEN v_index = v_order_count THEN p_amount_minor - v_allocated
      ELSE round(v_order.total_amount * 100)::bigint
    END;
    v_allocated := v_allocated + v_amount_minor;

    INSERT INTO public.payment_capture_allocations (
      capture_id, order_id, amount_minor, seller_id
    ) VALUES (
      v_capture.id, v_order.id, v_amount_minor, v_order.seller_id
    )
    ON CONFLICT (capture_id, order_id) DO UPDATE
    SET amount_minor = EXCLUDED.amount_minor,
        seller_id = EXCLUDED.seller_id
    WHERE public.payment_capture_allocations.amount_minor = EXCLUDED.amount_minor
      AND public.payment_capture_allocations.seller_id IS NOT DISTINCT FROM EXCLUDED.seller_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'existing capture allocation payload mismatch';
    END IF;
  END LOOP;

  RETURN v_commit || jsonb_build_object(
    'capture_id', v_capture.id,
    'allocated_minor', v_allocated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_captured_payment_group(
  p_order_ids uuid[],
  p_provider_payment_id text,
  p_provider_order_id text,
  p_amount_minor bigint,
  p_currency text,
  p_captured_at timestamptz,
  p_source text DEFAULT 'edge_confirm'
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.confirm_captured_payment_group(
    p_order_ids, p_provider_payment_id, p_provider_order_id, p_amount_minor,
    p_currency, p_captured_at, p_source
  );
$$;

REVOKE ALL ON FUNCTION public.confirm_captured_payment_group(
  uuid[], text, text, bigint, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_captured_payment_group(
  uuid[], text, text, bigint, text, timestamptz, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.link_razorpay_order_group(
  p_order_ids uuid[],
  p_razorpay_order_id text,
  p_checkout_group_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_ids uuid[];
  v_count integer;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
  INTO v_order_ids
  FROM unnest(COALESCE(p_order_ids, '{}'::uuid[])) id;
  IF cardinality(v_order_ids) = 0
     OR p_razorpay_order_id IS NULL
     OR btrim(p_razorpay_order_id) = '' THEN
    RAISE EXCEPTION 'provider order linkage requires order ids and provider id';
  END IF;

  PERFORM 1
  FROM public.orders
  WHERE id = ANY(v_order_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*) INTO v_count
  FROM public.orders
  WHERE id = ANY(v_order_ids);
  IF v_count <> cardinality(v_order_ids) THEN
    RAISE EXCEPTION 'provider order linkage references unknown orders';
  END IF;
  IF p_checkout_group_id IS NULL AND EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = ANY(v_order_ids)
      AND checkout_group_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'checkout group id is required for grouped orders';
  END IF;
  IF p_checkout_group_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = ANY(v_order_ids)
      AND checkout_group_id IS DISTINCT FROM p_checkout_group_id
  ) THEN
    RAISE EXCEPTION 'checkout group does not own every linked order';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = ANY(v_order_ids)
      AND razorpay_order_id IS NOT NULL
      AND razorpay_order_id <> p_razorpay_order_id
  ) THEN
    RAISE EXCEPTION 'order is already linked to a different provider order';
  END IF;

  UPDATE public.orders
  SET razorpay_order_id = p_razorpay_order_id,
      updated_at = now()
  WHERE id = ANY(v_order_ids);

  IF p_checkout_group_id IS NOT NULL THEN
    UPDATE public.checkout_groups
    SET razorpay_order_id = p_razorpay_order_id,
        payment_method = 'online',
        updated_at = now()
    WHERE id = p_checkout_group_id
      AND (
        razorpay_order_id IS NULL
        OR razorpay_order_id = p_razorpay_order_id
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'checkout group linkage conflict or missing group';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'linked', true,
    'order_count', cardinality(v_order_ids),
    'razorpay_order_id', p_razorpay_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_razorpay_order_group(
  uuid[], text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_razorpay_order_group(
  uuid[], text, uuid
) TO service_role;

COMMIT;
