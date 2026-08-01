
-- Phase 1: Restore INSERT trigger for new order notifications
-- This trigger was accidentally dropped by a previous migration

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seller_user_id uuid;
  v_buyer_name text;
  v_exists boolean;
BEGIN
  -- Only fire for placed or enquired orders
  IF NEW.status NOT IN ('placed', 'enquired') THEN
    RETURN NEW;
  END IF;

  -- Idempotency: check if a queue entry already exists for this order+status
  SELECT EXISTS(
    SELECT 1 FROM public.notification_queue
    WHERE (payload->>'orderId')::text = NEW.id::text
      AND (payload->>'status')::text = NEW.status
  ) INTO v_exists;

  IF v_exists THEN
    RETURN NEW;
  END IF;

  -- Get the seller's user_id from seller_profiles
  SELECT user_id INTO v_seller_user_id
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF v_seller_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get buyer name
  SELECT COALESCE(full_name, 'A buyer') INTO v_buyer_name
  FROM public.profiles
  WHERE id = NEW.buyer_id;

  -- Enqueue notification for the seller
  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user_id,
    CASE WHEN NEW.status = 'placed' THEN 'New Order Received! 🛒'
         ELSE 'New Enquiry Received! 💬'
    END,
    v_buyer_name || CASE WHEN NEW.status = 'placed' THEN ' placed a new order'
                         ELSE ' sent an enquiry'
                    END,
    CASE WHEN NEW.status = 'placed' THEN 'order_placed'
         ELSE 'enquiry_received'
    END,
    '/orders/' || NEW.id,
    jsonb_build_object('orderId', NEW.id, 'status', NEW.status, 'buyerId', NEW.buyer_id)
  );

  RETURN NEW;
END;
$$;

-- Create the INSERT trigger
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
CREATE TRIGGER trg_enqueue_new_order_notification
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_new_order_notification();
