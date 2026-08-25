-- Allow system actor to cancel unaccepted placed orders (acceptance timeout).
-- expire_unaccepted_order sets app.acting_as = 'system', but no placed→cancelled
-- rows existed for system — sweep aborted and overdue orders stayed accept-able
-- until seller_advance_order's hard gate (separate fix).

BEGIN;

-- Cover default fallback + food_beverages (resolve_transition_parent_group maps
-- home_services → default).
INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action
)
SELECT v.parent_group, v.transaction_type, 'placed', 'cancelled', 'system', false
FROM (VALUES
  ('default', 'cart_purchase'),
  ('default', 'seller_delivery'),
  ('default', 'self_fulfillment'),
  ('default', 'self_pickup'),
  ('default', 'delivery'),
  ('food_beverages', 'cart_purchase'),
  ('food_beverages', 'seller_delivery'),
  ('food_beverages', 'self_fulfillment'),
  ('food_beverages', 'self_pickup'),
  ('food_beverages', 'delivery')
) AS v(parent_group, transaction_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.category_status_transitions t
  WHERE t.parent_group = v.parent_group
    AND t.transaction_type = v.transaction_type
    AND t.from_status = 'placed'
    AND t.to_status = 'cancelled'
    AND t.allowed_actor = 'system'
);

-- Sweep must not abort the whole batch on one bad order
CREATE OR REPLACE FUNCTION public.sweep_expired_unaccepted_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  cancelled_ids uuid[] := '{}';
  failed_ids uuid[] := '{}';
  result jsonb;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.status = 'placed'::public.order_status
      AND COALESCE(o.auto_accepted, false) = false
      AND o.auto_cancel_at IS NOT NULL
      AND o.auto_cancel_at <= now()
    ORDER BY o.auto_cancel_at
    LIMIT 200
  LOOP
    BEGIN
      result := public.expire_unaccepted_order(r.id);
      IF COALESCE((result->>'cancelled')::boolean, false) THEN
        cancelled_ids := array_append(cancelled_ids, r.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      failed_ids := array_append(failed_ids, r.id);
      RAISE WARNING 'sweep_expired_unaccepted_orders failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'cancelled_count', COALESCE(array_length(cancelled_ids, 1), 0),
    'cancelled_ids', to_jsonb(cancelled_ids),
    'failed_count', COALESCE(array_length(failed_ids, 1), 0),
    'failed_ids', to_jsonb(failed_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_unaccepted_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_unaccepted_orders() TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_unaccepted_orders() TO postgres;

-- Clear currently overdue placed orders
SELECT public.sweep_expired_unaccepted_orders();

COMMIT;
