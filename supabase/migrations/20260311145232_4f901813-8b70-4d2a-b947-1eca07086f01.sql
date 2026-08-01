
-- 1. Add missing order statuses to the notification trigger
CREATE OR REPLACE FUNCTION public.enqueue_order_status_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _seller_name text;
  _buyer_name text;
  _short_order_id text;
  _notif_title text;
  _notif_body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _short_order_id := LEFT(NEW.id::text, 8);

  SELECT sp.user_id, sp.business_name
  INTO _seller_user_id, _seller_name
  FROM seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  SELECT p.name INTO _buyer_name
  FROM profiles p
  WHERE p.id = NEW.buyer_id;

  _seller_name := COALESCE(_seller_name, 'Seller');
  _buyer_name := COALESCE(_buyer_name, 'Customer');

  -- Seller notifications
  IF NEW.status = 'placed' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '🆕 New Order Received!',
      _buyer_name || ' placed an order. Tap to view and accept.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  IF NEW.status = 'enquired' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '📋 New Booking Request!',
      _buyer_name || ' sent a booking request.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- NEW: requested status → notify seller
  IF NEW.status = 'requested' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '📩 New Service Request!',
      _buyer_name || ' sent a service request. Tap to review.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- Seller notification for cancellation
  IF NEW.status = 'cancelled' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '❌ Order Cancelled',
      'Order #' || _short_order_id || ' from ' || _buyer_name || ' was cancelled.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- NEW: no_show → notify seller too
  IF NEW.status = 'no_show' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '🚫 Customer No-Show',
      _buyer_name || ' did not show up for their appointment.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- Buyer notifications
  CASE NEW.status
    WHEN 'accepted' THEN
      _notif_title := '✅ Order Accepted!';
      _notif_body := _seller_name || ' accepted your order and will start preparing it.';
    WHEN 'preparing' THEN
      _notif_title := '👨‍🍳 Order Being Prepared';
      _notif_body := _seller_name || ' is now preparing your order.';
    WHEN 'ready' THEN
      _notif_title := '🎉 Order Ready!';
      _notif_body := 'Your order from ' || _seller_name || ' is ready for pickup!';
    WHEN 'assigned' THEN
      _notif_title := '👤 Partner Assigned';
      _notif_body := 'A delivery partner has been assigned to your order.';
    WHEN 'picked_up' THEN
      _notif_title := '📦 Order Picked Up';
      _notif_body := 'Your order from ' || _seller_name || ' has been picked up.';
    WHEN 'on_the_way' THEN
      _notif_title := '🛵 Order On The Way!';
      _notif_body := 'Your order from ' || _seller_name || ' is on the way to you!';
    WHEN 'arrived' THEN
      _notif_title := '🏠 Service Provider Arrived';
      _notif_body := 'Your service provider from ' || _seller_name || ' has arrived.';
    WHEN 'in_progress' THEN
      _notif_title := '🔧 Service In Progress';
      _notif_body := _seller_name || ' has started working on your request.';
    WHEN 'delivered' THEN
      _notif_title := '🚚 Order Delivered';
      _notif_body := 'Your order from ' || _seller_name || ' has been delivered!';
    WHEN 'completed' THEN
      _notif_title := '⭐ Order Completed';
      _notif_body := 'Your order from ' || _seller_name || ' is complete. Leave a review!';
    WHEN 'cancelled' THEN
      _notif_title := '❌ Order Cancelled';
      _notif_body := 'Your order from ' || _seller_name || ' was cancelled.';
    WHEN 'quoted' THEN
      _notif_title := '💰 Quote Received';
      _notif_body := _seller_name || ' sent you a price quote for your enquiry.';
    WHEN 'scheduled' THEN
      _notif_title := '📅 Booking Confirmed';
      _notif_body := _seller_name || ' confirmed your booking.';
    WHEN 'confirmed' THEN
      _notif_title := '✅ Booking Confirmed';
      _notif_body := _seller_name || ' has confirmed your appointment.';
    WHEN 'no_show' THEN
      _notif_title := '🚫 Marked as No-Show';
      _notif_body := 'You were marked as a no-show for your appointment with ' || _seller_name || '.';
    WHEN 'returned' THEN
      _notif_title := '↩️ Order Returned';
      _notif_body := 'Your order from ' || _seller_name || ' has been returned.';
    ELSE
      _notif_title := NULL;
  END CASE;

  IF _notif_title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.buyer_id,
      _notif_title,
      _notif_body,
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Review notification trigger → notify seller when a review is submitted
CREATE OR REPLACE FUNCTION public.enqueue_review_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
BEGIN
  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.name INTO _buyer_name
  FROM profiles p WHERE p.id = NEW.buyer_id;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    '⭐ New Review!',
    COALESCE(_buyer_name, 'A customer') || ' rated you ' || NEW.rating || '/5' ||
      CASE WHEN NEW.comment IS NOT NULL AND LENGTH(NEW.comment) > 0
        THEN ': "' || LEFT(NEW.comment, 60) || CASE WHEN LENGTH(NEW.comment) > 60 THEN '..."' ELSE '"' END
        ELSE '.' END,
    'review',
    '/seller/reviews',
    jsonb_build_object('reviewId', NEW.id, 'rating', NEW.rating, 'type', 'review')
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_review_notification
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_review_notification();

-- 3. Dispute status change notification trigger
CREATE OR REPLACE FUNCTION public.enqueue_dispute_status_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _title text;
  _body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  CASE NEW.status
    WHEN 'under_review' THEN
      _title := '🔍 Dispute Under Review';
      _body := 'Your dispute is now being reviewed by the committee.';
    WHEN 'resolved' THEN
      _title := '✅ Dispute Resolved';
      _body := 'Your dispute has been resolved.' ||
        CASE WHEN NEW.resolution_note IS NOT NULL THEN ' Note: ' || LEFT(NEW.resolution_note, 80) ELSE '' END;
    WHEN 'rejected' THEN
      _title := '❌ Dispute Rejected';
      _body := 'Your dispute has been closed.' ||
        CASE WHEN NEW.resolution_note IS NOT NULL THEN ' Reason: ' || LEFT(NEW.resolution_note, 80) ELSE '' END;
    ELSE
      _title := NULL;
  END CASE;

  IF _title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.submitted_by,
      _title,
      _body,
      'dispute',
      '/disputes/' || NEW.id::text,
      jsonb_build_object('disputeId', NEW.id, 'status', NEW.status, 'type', 'dispute')
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_dispute_status_notification
  AFTER UPDATE ON dispute_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_dispute_status_notification();

-- 4. Settlement notification trigger → notify seller when settlement is created
CREATE OR REPLACE FUNCTION public.enqueue_settlement_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
BEGIN
  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    '💰 Payment Settlement Created',
    'A settlement of ₹' || NEW.net_amount || ' has been initiated for your order.',
    'settlement',
    '/seller/settlements',
    jsonb_build_object('settlementId', NEW.id, 'amount', NEW.net_amount, 'type', 'settlement')
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_settlement_notification
  AFTER INSERT ON payment_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_settlement_notification();
