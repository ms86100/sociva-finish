BEGIN;

CREATE OR REPLACE FUNCTION finance.assert_feature_enabled(p_key text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = p_key
  ), false) THEN
    RAISE EXCEPTION 'financial feature % is disabled', p_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION finance.assert_feature_enabled(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.assert_feature_enabled(text)
  TO service_role;

DO $$
BEGIN
  IF to_regprocedure(
    'public.reserve_wallet_credit_impl(numeric,text,text,uuid[])'
  ) IS NULL THEN
    ALTER FUNCTION public.reserve_wallet_credit(numeric, text, text, uuid[])
      RENAME TO reserve_wallet_credit_impl;
  END IF;

  IF to_regprocedure(
    'public.issue_wallet_promo_impl(uuid,numeric,timestamp with time zone,text,text,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.issue_wallet_promo(
      uuid, numeric, timestamptz, text, text, text, text
    ) RENAME TO issue_wallet_promo_impl;
  END IF;

  IF to_regprocedure(
    'public.commit_wallet_reservation_impl(uuid,uuid[])'
  ) IS NULL THEN
    ALTER FUNCTION public.commit_wallet_reservation(uuid, uuid[])
      RENAME TO commit_wallet_reservation_impl;
  END IF;

  IF to_regprocedure(
    'public.commit_wallet_for_orders_impl(uuid[])'
  ) IS NULL THEN
    ALTER FUNCTION public.commit_wallet_for_orders(uuid[])
      RENAME TO commit_wallet_for_orders_impl;
  END IF;
END;
$$;

ALTER FUNCTION public.reserve_wallet_credit_impl(numeric, text, text, uuid[])
  SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION public.issue_wallet_promo_impl(
  uuid, numeric, timestamptz, text, text, text, text
) SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION public.commit_wallet_reservation_impl(uuid, uuid[])
  SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION public.commit_wallet_for_orders_impl(uuid[])
  SET search_path = public, pg_catalog, pg_temp;

REVOKE ALL ON FUNCTION
  public.reserve_wallet_credit_impl(numeric, text, text, uuid[]),
  public.issue_wallet_promo_impl(
    uuid, numeric, timestamptz, text, text, text, text
  ),
  public.commit_wallet_reservation_impl(uuid, uuid[]),
  public.commit_wallet_for_orders_impl(uuid[])
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.reserve_wallet_credit_impl(numeric, text, text, uuid[]),
  public.issue_wallet_promo_impl(
    uuid, numeric, timestamptz, text, text, text, text
  ),
  public.commit_wallet_reservation_impl(uuid, uuid[]),
  public.commit_wallet_for_orders_impl(uuid[])
TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_wallet_credit(
  _amount numeric,
  _idempotency_key text DEFAULT NULL,
  _checkout_key text DEFAULT NULL,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM finance.assert_feature_enabled('wallet_spend_enabled');
  RETURN public.reserve_wallet_credit_impl(
    _amount, _idempotency_key, _checkout_key, _order_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_wallet_promo(
  _user_id uuid,
  _amount numeric,
  _expires_at timestamptz,
  _source text DEFAULT 'promo_campaign',
  _idempotency_key text DEFAULT NULL,
  _campaign_id text DEFAULT NULL,
  _description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM finance.assert_feature_enabled('wallet_issue_enabled');
  RETURN public.issue_wallet_promo_impl(
    _user_id, _amount, _expires_at, _source,
    _idempotency_key, _campaign_id, _description
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_wallet_reservation(
  _reservation_id uuid,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM finance.assert_feature_enabled('wallet_spend_enabled');
  RETURN public.commit_wallet_reservation_impl(_reservation_id, _order_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_wallet_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM finance.assert_feature_enabled('wallet_spend_enabled');
  RETURN public.commit_wallet_for_orders_impl(_order_ids);
END;
$$;

REVOKE ALL ON FUNCTION
  public.reserve_wallet_credit(numeric, text, text, uuid[]),
  public.issue_wallet_promo(
    uuid, numeric, timestamptz, text, text, text, text
  )
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.reserve_wallet_credit(numeric, text, text, uuid[]),
  public.issue_wallet_promo(
    uuid, numeric, timestamptz, text, text, text, text
  )
TO authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.commit_wallet_reservation(uuid, uuid[]),
  public.commit_wallet_for_orders(uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.commit_wallet_reservation(uuid, uuid[]),
  public.commit_wallet_for_orders(uuid[])
TO service_role;

ALTER FUNCTION public.release_wallet_reservation(uuid)
  SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION public.release_wallet_for_orders(uuid[])
  SET search_path = public, pg_catalog, pg_temp;

REVOKE ALL ON FUNCTION
  public.release_wallet_reservation(uuid),
  public.release_wallet_for_orders(uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.release_wallet_reservation(uuid),
  public.release_wallet_for_orders(uuid[])
TO service_role;

COMMIT;
