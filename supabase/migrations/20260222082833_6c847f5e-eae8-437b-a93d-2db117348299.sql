
-- Order State Machine: enforce valid status transitions
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _allowed text[];
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Define allowed transitions per current status
  CASE OLD.status::text
    WHEN 'placed' THEN
      _allowed := ARRAY['accepted', 'cancelled'];
    WHEN 'accepted' THEN
      _allowed := ARRAY['preparing', 'cancelled'];
    WHEN 'preparing' THEN
      _allowed := ARRAY['ready', 'cancelled'];
    WHEN 'ready' THEN
      _allowed := ARRAY['picked_up', 'delivered', 'completed', 'cancelled'];
    WHEN 'picked_up' THEN
      _allowed := ARRAY['delivered', 'completed'];
    WHEN 'delivered' THEN
      _allowed := ARRAY['completed', 'returned'];
    WHEN 'enquired' THEN
      _allowed := ARRAY['quoted', 'cancelled'];
    WHEN 'quoted' THEN
      _allowed := ARRAY['accepted', 'scheduled', 'cancelled'];
    WHEN 'scheduled' THEN
      _allowed := ARRAY['in_progress', 'cancelled'];
    WHEN 'in_progress' THEN
      _allowed := ARRAY['completed', 'cancelled'];
    WHEN 'completed' THEN
      _allowed := ARRAY[]::text[]; -- terminal
    WHEN 'cancelled' THEN
      _allowed := ARRAY[]::text[]; -- terminal
    WHEN 'returned' THEN
      _allowed := ARRAY[]::text[]; -- terminal
    ELSE
      _allowed := ARRAY[]::text[];
  END CASE;

  IF NOT (NEW.status::text = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Invalid order status transition: % → %. Allowed: %',
      OLD.status, NEW.status, array_to_string(_allowed, ', ');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();
