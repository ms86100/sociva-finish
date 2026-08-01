CREATE OR REPLACE FUNCTION public.verify_generic_otp_and_advance(_order_id uuid, _otp_code text, _target_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller_id uuid;
  _order_record public.orders;
  _seller_user_id uuid;
  _otp_record public.order_otp_codes;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO _order_record FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF _order_record.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT sp.user_id INTO _seller_user_id FROM public.seller_profiles sp WHERE sp.id = _order_record.seller_id;
  IF _caller_id IS DISTINCT FROM _order_record.buyer_id AND _caller_id IS DISTINCT FROM _seller_user_id THEN
    RAISE EXCEPTION 'Not authorized for this order';
  END IF;

  -- Pick the LATEST unused OTP for this order+status (fixes multi-refresh bug)
  SELECT * INTO _otp_record
    FROM public.order_otp_codes
   WHERE order_id = _order_id
     AND target_status = _target_status
     AND is_used = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF _otp_record.id IS NULL THEN RAISE EXCEPTION 'No valid OTP code found for this step'; END IF;
  IF _otp_record.expires_at < now() THEN RAISE EXCEPTION 'OTP has expired'; END IF;
  IF btrim(_otp_record.otp_code) <> btrim(_otp_code) THEN RAISE EXCEPTION 'Invalid OTP code'; END IF;

  -- Mark ALL unused OTPs for this order+status as used (cleanup old ones)
  UPDATE public.order_otp_codes
     SET is_used = true, used_at = now()
   WHERE order_id = _order_id
     AND target_status = _target_status
     AND is_used = false;

  PERFORM set_config('app.otp_verified', 'true', true);

  IF _caller_id = _seller_user_id THEN
    PERFORM set_config('app.acting_as', 'seller', true);
  ELSIF _caller_id = _order_record.buyer_id THEN
    PERFORM set_config('app.acting_as', 'buyer', true);
  END IF;

  UPDATE public.orders
     SET status = _target_status::order_status,
         status_updated_at = now(),
         updated_at = now()
   WHERE id = _order_id;
END;
$function$;