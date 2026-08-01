
-- Step 1: Delivery → Order Status Sync Trigger
CREATE OR REPLACE FUNCTION public.sync_delivery_to_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  CASE NEW.status
    WHEN 'picked_up' THEN
      UPDATE public.orders SET status = 'picked_up' WHERE id = NEW.order_id AND status = 'ready';
    WHEN 'at_gate' THEN
      UPDATE public.orders SET status = 'on_the_way' WHERE id = NEW.order_id AND status = 'picked_up';
    WHEN 'delivered' THEN
      UPDATE public.orders SET status = 'delivered' WHERE id = NEW.order_id;
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_sync_delivery_to_order
  AFTER UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_to_order_status();

-- Step 4: Add ready_at to orders (set via trigger when status becomes ready)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ready_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_order_ready_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'ready' AND (OLD.status IS DISTINCT FROM 'ready') THEN
    NEW.ready_at = now();
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_set_order_ready_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_ready_at();

-- Step 4: Add stalled_notified to delivery_assignments
ALTER TABLE public.delivery_assignments ADD COLUMN IF NOT EXISTS stalled_notified boolean DEFAULT false;
