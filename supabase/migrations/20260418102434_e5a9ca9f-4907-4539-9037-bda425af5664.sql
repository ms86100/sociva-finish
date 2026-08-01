CREATE OR REPLACE FUNCTION public.fn_validate_support_ticket_seller()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_resolved_user_id uuid;
BEGIN
  IF NEW.seller_id IS NULL THEN
    RAISE EXCEPTION 'seller_not_resolvable: seller_id is null'
      USING ERRCODE = 'P0001';
  END IF;

  -- Happy path: seller_id is already a valid profiles.id
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.seller_id) THEN
    -- ok
    NULL;
  ELSE
    -- Auto-translate: maybe caller passed a seller_profiles.id by mistake
    SELECT sp.user_id INTO v_resolved_user_id
    FROM public.seller_profiles sp
    WHERE sp.id = NEW.seller_id;

    IF v_resolved_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_resolved_user_id) THEN
      NEW.seller_id := v_resolved_user_id;
    ELSE
      RAISE EXCEPTION 'seller_not_resolvable: seller_id % is not a valid profile', NEW.seller_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.buyer_id) THEN
    RAISE EXCEPTION 'buyer_not_resolvable: buyer_id % is not a valid profile', NEW.buyer_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;