
CREATE OR REPLACE FUNCTION auto_dismiss_delivery_notifications()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('delivered', 'completed') 
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE user_notifications
    SET is_read = true
    WHERE user_id = NEW.buyer_id
      AND is_read = false
      AND type IN ('delivery_delayed', 'delivery_stalled', 
                   'delivery_en_route', 'delivery_proximity',
                   'delivery_proximity_imminent')
      AND (payload->>'order_id' = NEW.id::text 
           OR reference_path LIKE '%' || NEW.id::text || '%');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_dismiss_delivery_notifications
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_dismiss_delivery_notifications();
