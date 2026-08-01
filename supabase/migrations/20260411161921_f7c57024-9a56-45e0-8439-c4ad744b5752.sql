
-- #7: Seller Earnings Push Notification
-- Update the notification impl to also fire on payment_status changes
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_buyer_name text;
  v_seller_name text;
  v_seller_user_id uuid;
  v_amount numeric;
  v_flow_step record;
  v_short_id text;
BEGIN
  v_short_id := LEFT(p_new.id::text, 8);

  -- Payment status change notification (seller earnings)
  IF p_old.payment_status IS DISTINCT FROM p_new.payment_status
     AND p_new.payment_status IN ('confirmed', 'settled') THEN

    -- Get buyer name
    SELECT name INTO v_buyer_name FROM profiles WHERE id = p_new.buyer_id;
    -- Get seller user_id
    SELECT user_id, business_name INTO v_seller_user_id, v_seller_name FROM seller_profiles WHERE id = p_new.seller_id;
    v_amount := p_new.total_amount;

    IF v_seller_user_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, action, related_id)
      VALUES (
        v_seller_user_id,
        'Payment received: ₹' || v_amount,
        'For order from ' || COALESCE(v_buyer_name, 'Customer') || ' (#' || v_short_id || ')',
        'payment',
        '/orders/' || p_new.id,
        p_new.id
      );
    END IF;
  END IF;

  -- Order status change notification (existing behavior)
  IF p_old.status IS DISTINCT FROM p_new.status THEN
    -- Look up flow step for the new status
    SELECT * INTO v_flow_step
    FROM category_status_flows
    WHERE status_key = p_new.status
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN;
    END IF;

    -- Get names
    SELECT name INTO v_buyer_name FROM profiles WHERE id = p_new.buyer_id;
    SELECT user_id, business_name INTO v_seller_user_id, v_seller_name FROM seller_profiles WHERE id = p_new.seller_id;

    -- Notify buyer
    IF v_flow_step.notify_buyer AND p_new.buyer_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, action, related_id)
      VALUES (
        p_new.buyer_id,
        COALESCE(v_flow_step.notification_title, v_flow_step.display_name || ' — Order #' || v_short_id),
        COALESCE(
          REPLACE(COALESCE(v_flow_step.notification_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller')),
          'Your order status has been updated'
        ),
        'order_update',
        '/orders/' || p_new.id,
        p_new.id
      );
    END IF;

    -- Notify seller
    IF v_flow_step.notify_seller AND v_seller_user_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, action, related_id)
      VALUES (
        v_seller_user_id,
        COALESCE(v_flow_step.seller_notification_title, v_flow_step.display_name || ' — Order #' || v_short_id),
        COALESCE(
          REPLACE(COALESCE(v_flow_step.seller_notification_body, ''), '{buyer_name}', COALESCE(v_buyer_name, 'Customer')),
          'Order status updated'
        ),
        'order_update',
        '/orders/' || p_new.id,
        p_new.id
      );
    END IF;
  END IF;
END;
$f$;

-- #11: Self-pickup handover OTP configuration
-- Update existing 'picked_up' flow steps to require generic OTP for self_pickup verification
UPDATE public.category_status_flows
SET requires_otp = true, otp_type = 'generic'
WHERE status_key = 'picked_up'
  AND requires_otp = false;
