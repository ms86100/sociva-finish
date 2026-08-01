
CREATE OR REPLACE FUNCTION public.log_price_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid;
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price AND OLD.price IS NOT NULL AND NEW.price IS NOT NULL THEN
    -- Resolve the actual user_id from seller_profiles
    SELECT user_id INTO _user_id FROM public.seller_profiles WHERE id = NEW.seller_id;
    
    INSERT INTO price_history (product_id, old_price, new_price, changed_by)
    VALUES (NEW.id, OLD.price, NEW.price, COALESCE(_user_id, NEW.seller_id));
    NEW.price_stable_since := now();
  END IF;
  RETURN NEW;
END;
$function$;
