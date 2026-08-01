
-- Delete all order-related data for user 4a005c1b-8f41-43c0-8752-962eefaa6821
DO $$
DECLARE
  uid uuid := '4a005c1b-8f41-43c0-8752-962eefaa6821';
BEGIN
  -- Child tables referencing orders
  DELETE FROM chat_messages WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  DELETE FROM delivery_feedback WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  DELETE FROM coupon_redemptions WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  DELETE FROM payment_settlements WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  
  -- Delete delivery locations before assignments
  DELETE FROM delivery_locations WHERE assignment_id IN (
    SELECT id FROM delivery_assignments WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid)
  );
  DELETE FROM delivery_assignments WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = uid OR seller_id = uid);
  
  -- Delete call_feedback referencing seller_contact_interactions
  -- (skip if not related)
  
  -- Delete orders
  DELETE FROM orders WHERE buyer_id = uid OR seller_id = uid;
  
  -- Delete notifications
  DELETE FROM user_notifications WHERE user_id = uid;
  DELETE FROM notification_queue WHERE user_id = uid;
END $$;
