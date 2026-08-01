
-- ═══════════════════════════════════════════════════════
-- Feature 2: Auto-update seller rating + reputation ledger on review insert
-- ═══════════════════════════════════════════════════════

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_after_insert ON reviews;
CREATE TRIGGER trg_review_after_insert
AFTER INSERT ON reviews
FOR EACH ROW
EXECUTE FUNCTION fn_review_after_insert();


-- ═══════════════════════════════════════════════════════
-- Feature 2: Enqueue "Rate your order" notification on successful delivery
-- Add review prompt notification to the existing order status notification trigger
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_enqueue_review_prompt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _flow RECORD;
  _txn_type TEXT;
  _parent_group TEXT;
  _seller_name TEXT;
  _order_number TEXT;
  _already_reviewed BOOLEAN;
BEGIN
  IF TG_OP != 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  SELECT resolve_transition_parent_group(sp.primary_group), sp.business_name
  INTO _parent_group, _seller_name
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := COALESCE(_parent_group, 'default');

  -- Check if this status is a successful terminal status
  SELECT * INTO _flow FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group
    AND status_key = NEW.status::text AND is_terminal = true AND is_success = true
  LIMIT 1;

  IF _flow.id IS NULL THEN
    SELECT * INTO _flow FROM category_status_flows
    WHERE transaction_type = _txn_type AND parent_group = 'default'
      AND status_key = NEW.status::text AND is_terminal = true AND is_success = true
    LIMIT 1;
  END IF;

  IF _flow.id IS NULL THEN RETURN NEW; END IF;

  -- Check if buyer already reviewed this order
  SELECT EXISTS(SELECT 1 FROM reviews WHERE order_id = NEW.id AND buyer_id = NEW.buyer_id)
  INTO _already_reviewed;

  IF _already_reviewed THEN RETURN NEW; END IF;

  _order_number := upper(right(NEW.id::text, 6));

  -- Enqueue review prompt notification (delayed by 30 min conceptually, but we send immediately — app handles timing)
  INSERT INTO notification_queue (user_id, title, body, type, payload)
  VALUES (
    NEW.buyer_id,
    '⭐ How was your order?',
    'Rate your experience with ' || COALESCE(_seller_name, 'the seller') || ' (#' || _order_number || ')',
    'review_prompt',
    jsonb_build_object('order_id', NEW.id, 'seller_id', NEW.seller_id, 'action', 'review')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_review_prompt ON orders;
CREATE TRIGGER trg_enqueue_review_prompt
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION fn_enqueue_review_prompt();


-- ═══════════════════════════════════════════════════════
-- Feature 8: Server-side store availability check function
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_seller_availability(p_seller_id UUID)
RETURNS TABLE(is_open BOOLEAN, reason TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seller RECORD;
  _now TIMESTAMP;
  _current_day TEXT;
  _day_abbrevs TEXT[] := ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  _current_minutes INTEGER;
  _start_minutes INTEGER;
  _end_minutes INTEGER;
  _start_parts TEXT[];
  _end_parts TEXT[];
BEGIN
  SELECT s.is_available, s.operating_days, s.availability_start, s.availability_end, s.business_name
  INTO _seller
  FROM seller_profiles s WHERE s.id = p_seller_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Seller not found'::TEXT;
    RETURN;
  END IF;

  IF NOT _seller.is_available THEN
    RETURN QUERY SELECT false, 'Store is currently paused'::TEXT;
    RETURN;
  END IF;

  -- If no hours configured, store is always open
  IF _seller.availability_start IS NULL OR _seller.availability_end IS NULL THEN
    RETURN QUERY SELECT true, 'Open'::TEXT;
    RETURN;
  END IF;

  _now := now() AT TIME ZONE 'Asia/Kolkata';
  _current_day := _day_abbrevs[EXTRACT(DOW FROM _now)::INTEGER + 1];

  -- Check operating days
  IF _seller.operating_days IS NOT NULL AND array_length(_seller.operating_days, 1) > 0
     AND NOT (_current_day = ANY(_seller.operating_days)) THEN
    RETURN QUERY SELECT false, (_seller.business_name || ' is closed today')::TEXT;
    RETURN;
  END IF;

  -- Check time window
  _start_parts := string_to_array(_seller.availability_start, ':');
  _end_parts := string_to_array(_seller.availability_end, ':');
  _start_minutes := _start_parts[1]::INTEGER * 60 + _start_parts[2]::INTEGER;
  _end_minutes := _end_parts[1]::INTEGER * 60 + _end_parts[2]::INTEGER;
  IF _end_minutes = 0 THEN _end_minutes := 1440; END IF;

  _current_minutes := EXTRACT(HOUR FROM _now)::INTEGER * 60 + EXTRACT(MINUTE FROM _now)::INTEGER;

  -- Handle overnight hours
  IF _end_minutes <= _start_minutes THEN
    IF _current_minutes >= _start_minutes OR _current_minutes < _end_minutes THEN
      RETURN QUERY SELECT true, 'Open'::TEXT;
    ELSE
      RETURN QUERY SELECT false, (_seller.business_name || ' opens at ' || _seller.availability_start)::TEXT;
    END IF;
  ELSE
    IF _current_minutes >= _start_minutes AND _current_minutes < _end_minutes THEN
      RETURN QUERY SELECT true, 'Open'::TEXT;
    ELSE
      RETURN QUERY SELECT false, (_seller.business_name || ' opens at ' || _seller.availability_start)::TEXT;
    END IF;
  END IF;

  RETURN;
END;
$$;
