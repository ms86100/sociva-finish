
-- Bug 1: Sync service_bookings.status when orders.status changes
CREATE OR REPLACE FUNCTION public.sync_booking_status_on_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.order_type = 'booking' THEN
    UPDATE service_bookings
    SET status = NEW.status::text
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_booking_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_status_on_order_update();

-- One-time fix: sync existing out-of-sync bookings
UPDATE service_bookings sb
SET status = o.status::text
FROM orders o
WHERE sb.order_id = o.id
  AND sb.status::text IS DISTINCT FROM o.status::text;
