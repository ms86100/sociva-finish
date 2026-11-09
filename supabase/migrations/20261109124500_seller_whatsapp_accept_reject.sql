-- Personal WhatsApp Accept / Reject for a waiting order.
-- The sender phone must match the seller profile. Groups cannot call this.

CREATE OR REPLACE FUNCTION public.seller_whatsapp_decide_order(
  p_order_id uuid,
  p_decision text,
  p_phone text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_user uuid;
  v_seller_phone text;
  v_status text;
  v_incoming text;
  v_result order_status;
BEGIN
  IF p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  v_incoming := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  IF length(v_incoming) <> 10 THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT sp.user_id,
         right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10),
         o.status::text
  INTO v_seller_user, v_seller_phone, v_status
  FROM public.orders o
  JOIN public.seller_profiles sp ON sp.id = o.seller_id
  JOIN public.profiles pr ON pr.id = sp.user_id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_seller_user IS NULL
     OR v_seller_phone IS DISTINCT FROM v_incoming
     OR length(v_seller_phone) <> 10 THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_status NOT IN ('placed', 'enquired', 'requested', 'quoted') THEN
    RAISE EXCEPTION 'Order is no longer waiting';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

  IF p_decision = 'accept' THEN
    v_result := public.seller_advance_order(p_order_id, 'accepted', NULL);
  ELSE
    v_result := public.seller_advance_order(
      p_order_id,
      'cancelled',
      'Rejected by seller: WhatsApp'
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_decide_order(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_decide_order(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_invoke_nudge_seller_accept_whatsapp()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
BEGIN
  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/nudge-seller-accept-whatsapp';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_nudge_seller_accept_whatsapp: pnq_worker_secret missing - skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_nudge_seller_accept_whatsapp()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_nudge_seller_accept_whatsapp()
  TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'nudge_seller_accept_whatsapp_every_minute'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'nudge_seller_accept_whatsapp_every_minute',
  '* * * * *',
  $$SELECT public.fn_invoke_nudge_seller_accept_whatsapp();$$
);
