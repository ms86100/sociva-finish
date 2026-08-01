
CREATE OR REPLACE FUNCTION public.enqueue_product_review_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_name text;
  _admin_row record;
BEGIN
  -- Only fire when approval_status changes TO 'pending'
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.approval_status IS NOT DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get seller business name
  SELECT sp.business_name INTO _seller_name
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  _seller_name := COALESCE(_seller_name, 'Unknown Store');

  -- Notify all admin-role users
  FOR _admin_row IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin'
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin_row.user_id,
      '📦 New Product for Review',
      '"' || COALESCE(NEW.name, 'A product') || '" from "' || _seller_name || '" needs review.',
      'moderation',
      '/admin',
      jsonb_build_object('type', 'product_review', 'productId', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_enqueue_product_review_notification ON public.products;
CREATE TRIGGER trg_enqueue_product_review_notification
  AFTER INSERT OR UPDATE OF approval_status ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_product_review_notification();
