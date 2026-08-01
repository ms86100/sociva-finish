
CREATE OR REPLACE FUNCTION public.notify_favorited_seller_new_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_queue (user_id, title, body, type, payload)
  SELECT
    f.user_id,
    'New from ' || sp.business_name,
    NEW.name || ' just added!',
    'new_product',
    jsonb_build_object('product_id', NEW.id, 'seller_id', NEW.seller_id)
  FROM public.favorites f
  JOIN public.seller_profiles sp ON sp.id = f.seller_id
  WHERE f.seller_id = NEW.seller_id
    AND f.user_id != sp.user_id;
  RETURN NEW;
END;
$$;
