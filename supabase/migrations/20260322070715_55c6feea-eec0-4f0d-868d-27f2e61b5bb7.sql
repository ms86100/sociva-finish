
-- 1. Auto-inherit trigger: copies notification fields from 'default' group on INSERT
CREATE OR REPLACE FUNCTION fn_inherit_notification_defaults()
RETURNS trigger AS $$
BEGIN
  IF NEW.parent_group <> 'default' AND NEW.notification_title IS NULL THEN
    SELECT 
      COALESCE(NEW.notify_buyer, d.notify_buyer),
      COALESCE(NEW.notify_seller, d.notify_seller),
      d.notification_title,
      d.notification_body,
      d.notification_action,
      d.seller_notification_title,
      d.seller_notification_body
    INTO
      NEW.notify_buyer,
      NEW.notify_seller,
      NEW.notification_title,
      NEW.notification_body,
      NEW.notification_action,
      NEW.seller_notification_title,
      NEW.seller_notification_body
    FROM category_status_flows d
    WHERE d.parent_group = 'default'
      AND d.transaction_type = NEW.transaction_type
      AND d.status_key = NEW.status_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inherit_notification_defaults
  BEFORE INSERT ON category_status_flows
  FOR EACH ROW
  EXECUTE FUNCTION fn_inherit_notification_defaults();

-- 2. Backfill ALL existing non-default rows with NULL notification_title
UPDATE category_status_flows csf
SET notify_buyer = d.notify_buyer,
    notify_seller = d.notify_seller,
    notification_title = d.notification_title,
    notification_body = d.notification_body,
    notification_action = d.notification_action,
    seller_notification_title = d.seller_notification_title,
    seller_notification_body = d.seller_notification_body
FROM category_status_flows d
WHERE csf.parent_group <> 'default'
  AND csf.notification_title IS NULL
  AND d.parent_group = 'default'
  AND d.transaction_type = csf.transaction_type
  AND d.status_key = csf.status_key;
