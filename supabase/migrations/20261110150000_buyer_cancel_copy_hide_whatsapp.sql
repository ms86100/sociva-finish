-- Buyer-facing cancel copy must not name the channel.
-- A seller reject from a personal chat stores the same line the buyer reads.

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
      'Order cancelled by seller'
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_decide_order(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_decide_order(uuid, text, text)
  TO service_role;

UPDATE public.orders
SET rejection_reason = 'Order cancelled by seller'
WHERE rejection_reason = 'Rejected by seller: WhatsApp';

UPDATE public.notification_queue
SET body = 'Order cancelled by seller'
WHERE body = 'Rejected by seller: WhatsApp';

UPDATE public.user_notifications
SET body = 'Order cancelled by seller'
WHERE body = 'Rejected by seller: WhatsApp';
