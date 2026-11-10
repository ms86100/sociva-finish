-- The first seller WhatsApp for a new order is the Accept / Reject card,
-- not the plain "tap to review" text. Push and in-app stay on the queue.
-- Later status WhatsApp is unchanged.

CREATE OR REPLACE FUNCTION public.fn_limit_buyer_order_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  role text;
  status text;
BEGIN
  IF NEW.type NOT IN ('order', 'order_status', 'order_update') THEN
    RETURN NEW;
  END IF;

  role := COALESCE(NEW.payload->>'target_role', '');
  status := lower(COALESCE(NEW.payload->>'status', NEW.payload->>'new_status', ''));

  IF role = 'seller' AND status IN ('placed', 'enquired', 'requested', 'quoted') THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('skip_whatsapp', true);
    RETURN NEW;
  END IF;

  IF role <> 'buyer' THEN
    RETURN NEW;
  END IF;

  IF status NOT IN (
    'accepted',
    'auto_accepted',
    'confirmed',
    'scheduled',
    'cancelled',
    'rejected',
    'no_show',
    'delivered',
    'completed',
    'refund_requested',
    'refund_approved',
    'refund_completed',
    'refund_failed',
    'refund_rejected',
    'payment_failed'
  ) THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('skip_whatsapp', true);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_invoke_seller_new_order_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
  v_role text;
  v_status text;
  v_order_id text;
BEGIN
  IF NEW.type NOT IN ('order', 'order_status', 'order_update') THEN
    RETURN NEW;
  END IF;

  v_role := COALESCE(NEW.payload->>'target_role', '');
  v_status := lower(COALESCE(NEW.payload->>'status', NEW.payload->>'new_status', ''));
  v_order_id := COALESCE(NEW.payload->>'orderId', NEW.payload->>'order_id', '');
  IF v_role <> 'seller'
     OR v_status NOT IN ('placed', 'enquired', 'requested', 'quoted')
     OR v_order_id !~* '^[0-9a-f-]{36}$' THEN
    RETURN NEW;
  END IF;

  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/seller-new-order-whatsapp';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_seller_new_order_whatsapp: pnq_worker_secret missing - skip';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('order_id', v_order_id, 'trigger', 'new_order')
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_seller_new_order_whatsapp()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_seller_new_order_whatsapp()
  TO service_role;

DROP TRIGGER IF EXISTS trg_seller_new_order_whatsapp ON public.notification_queue;
CREATE TRIGGER trg_seller_new_order_whatsapp
  AFTER INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_invoke_seller_new_order_whatsapp();
