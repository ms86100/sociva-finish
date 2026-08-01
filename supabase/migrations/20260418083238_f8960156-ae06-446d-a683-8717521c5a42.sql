
CREATE OR REPLACE FUNCTION public.fn_review_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _avg_rating NUMERIC;
  _total_reviews INTEGER;
  _is_positive BOOLEAN;
  _seller_user_id UUID;
  _buyer_name TEXT;
BEGIN
  SELECT AVG(rating)::NUMERIC(3,2), COUNT(*)
  INTO _avg_rating, _total_reviews
  FROM reviews
  WHERE seller_id = NEW.seller_id AND is_hidden = false;

  UPDATE seller_profiles
  SET rating = _avg_rating, total_reviews = _total_reviews, updated_at = now()
  WHERE id = NEW.seller_id;

  _is_positive := NEW.rating >= 4;
  INSERT INTO seller_reputation_ledger (seller_id, event_type, points, description, reference_id, metadata)
  VALUES (
    NEW.seller_id,
    'review_received',
    CASE WHEN _is_positive THEN 5 ELSE -2 END,
    CASE WHEN _is_positive THEN 'Positive review received' ELSE 'Low rating review received' END,
    NEW.id::text,
    jsonb_build_object('rating', NEW.rating, 'order_id', NEW.order_id)
  );

  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  SELECT COALESCE(name, 'A customer') INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;

  IF _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
      CASE WHEN _is_positive THEN '⭐ New review!' ELSE '📝 New review received' END,
      _buyer_name || ' gave you ' || NEW.rating || ' stars' ||
        CASE WHEN NEW.comment IS NOT NULL AND NEW.comment != '' THEN ': "' || LEFT(NEW.comment, 80) || '"' ELSE '' END,
      'review_received',
      '/seller/dashboard',
      jsonb_build_object(
        'type', 'review_received',
        'entity_type', 'review',
        'entity_id', NEW.id,
        'rating', NEW.rating,
        'order_id', NEW.order_id
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;
