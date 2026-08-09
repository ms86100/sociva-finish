-- ------------------------------------------------------------
-- 7. Optional backfill: recent multi-order checkouts via soft keys
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_group_id uuid;
  v_cnt int := 0;
BEGIN
  FOR r IN
    SELECT
      o.buyer_id,
      regexp_replace(o.idempotency_key, ':[^:]*$', '') AS checkout_key,
      min(o.created_at) AS first_created,
      (array_agg(o.society_id ORDER BY o.created_at))[1] AS society_id,
      (array_agg(o.payment_type ORDER BY o.created_at))[1] AS payment_type,
      (array_agg(o.payment_status ORDER BY o.created_at))[1] AS payment_status,
      (array_agg(o.fulfillment_type ORDER BY o.created_at))[1] AS fulfillment_type,
      array_agg(o.id ORDER BY o.created_at, o.id) AS order_ids
    FROM public.orders o
    WHERE o.checkout_group_id IS NULL
      AND o.idempotency_key IS NOT NULL
      AND position(':' IN o.idempotency_key) > 0
      AND o.created_at > now() - interval '90 days'
    GROUP BY o.buyer_id, regexp_replace(o.idempotency_key, ':[^:]*$', '')
    HAVING count(*) >= 1
  LOOP
    SELECT cg.id INTO v_group_id
    FROM public.checkout_groups cg
    WHERE cg.idempotency_key = r.checkout_key
      AND cg.buyer_id = r.buyer_id;

    IF v_group_id IS NULL THEN
      INSERT INTO public.checkout_groups (
        buyer_id, society_id, payment_method, payment_status,
        fulfillment_type, idempotency_key, created_at
      ) VALUES (
        r.buyer_id, r.society_id, r.payment_type, COALESCE(r.payment_status, 'pending'),
        r.fulfillment_type, r.checkout_key, r.first_created
      )
      RETURNING id INTO v_group_id;
    END IF;

    UPDATE public.orders
    SET checkout_group_id = v_group_id
    WHERE id = ANY (r.order_ids)
      AND checkout_group_id IS NULL;

    PERFORM public.refresh_checkout_group_totals(v_group_id);
    v_cnt := v_cnt + 1;
  END LOOP;

  RAISE NOTICE 'checkout_groups backfill groups linked: %', v_cnt;
END $$;
