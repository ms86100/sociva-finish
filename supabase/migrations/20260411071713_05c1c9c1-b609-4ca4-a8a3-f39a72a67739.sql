
-- ============================================================
-- 1. Auto-populate payment_records when order payment is confirmed
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_populate_payment_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when payment_status changes to a confirmed state
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('buyer_confirmed', 'paid', 'completed', 'seller_verified')
  THEN
    INSERT INTO payment_records (
      order_id, buyer_id, seller_id, amount, payment_method, payment_status,
      transaction_reference, society_id, payment_mode,
      razorpay_payment_id, idempotency_key
    ) VALUES (
      NEW.id,
      NEW.buyer_id,
      NEW.seller_id,
      NEW.total_amount,
      COALESCE(NEW.payment_type, 'cod'),
      NEW.payment_status,
      NEW.razorpay_payment_id,
      NEW.society_id,
      CASE WHEN NEW.payment_type IN ('upi', 'card', 'razorpay') THEN 'online' ELSE 'offline' END,
      NEW.razorpay_payment_id,
      'pay_' || NEW.id || '_' || NEW.payment_status
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      payment_status = EXCLUDED.payment_status,
      updated_at = now();
  END IF;

  -- Also handle refund states
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('refund_initiated', 'refund_processing', 'refunded')
  THEN
    UPDATE payment_records
    SET payment_status = NEW.payment_status, updated_at = now()
    WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_payment_record ON orders;
CREATE TRIGGER trg_populate_payment_record
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_populate_payment_record();

-- Add unique constraint on idempotency_key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_records_idempotency_key_key'
  ) THEN
    ALTER TABLE payment_records ADD CONSTRAINT payment_records_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END $$;

-- ============================================================
-- 2. Chat message push notification trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_chat_message_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_status TEXT;
  _sender_name TEXT;
BEGIN
  -- Only notify for active orders
  SELECT status INTO _order_status FROM orders WHERE id = NEW.order_id;
  IF _order_status IS NULL OR _order_status IN ('cancelled', 'completed', 'rejected', 'refunded') THEN
    RETURN NEW;
  END IF;

  -- Get sender name
  SELECT COALESCE(name, 'Someone') INTO _sender_name FROM profiles WHERE id = NEW.sender_id;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.receiver_id,
    '💬 New message',
    _sender_name || ': ' || LEFT(NEW.message_text, 100),
    'chat_message',
    '/orders/' || NEW.order_id,
    jsonb_build_object(
      'type', 'chat_message',
      'entity_type', 'order',
      'entity_id', NEW.order_id,
      'sender_id', NEW.sender_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_notification ON chat_messages;
CREATE TRIGGER trg_chat_message_notification
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_chat_message_notification();

-- ============================================================
-- 3. Add seller notification to review trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_review_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _avg_rating NUMERIC;
  _total_reviews INTEGER;
  _is_positive BOOLEAN;
  _seller_user_id UUID;
  _buyer_name TEXT;
BEGIN
  -- Compute new average rating and total reviews for the seller
  SELECT AVG(rating)::NUMERIC(3,2), COUNT(*)
  INTO _avg_rating, _total_reviews
  FROM reviews
  WHERE seller_id = NEW.seller_id AND is_hidden = false;

  -- Update seller_profiles with new rating
  UPDATE seller_profiles
  SET rating = _avg_rating, total_reviews = _total_reviews, updated_at = now()
  WHERE id = NEW.seller_id;

  -- Insert reputation ledger entry
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

  -- Notify the seller about the new review
  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  SELECT COALESCE(name, 'A customer') INTO _buyer_name FROM profiles WHERE id = NEW.user_id;

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
$$;

-- ============================================================
-- 4. Drop orphaned function
-- ============================================================
DROP FUNCTION IF EXISTS public.check_seller_availability(UUID);
