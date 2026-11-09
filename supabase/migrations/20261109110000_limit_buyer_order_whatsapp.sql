-- Buyer WhatsApp stays on milestones only.
-- Push and in-app still fire for every order status.
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
  IF role <> 'buyer' THEN
    RETURN NEW;
  END IF;

  status := lower(COALESCE(NEW.payload->>'status', NEW.payload->>'new_status', ''));
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

DROP TRIGGER IF EXISTS trg_limit_buyer_order_whatsapp ON public.notification_queue;

CREATE TRIGGER trg_limit_buyer_order_whatsapp
BEFORE INSERT ON public.notification_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_limit_buyer_order_whatsapp();
