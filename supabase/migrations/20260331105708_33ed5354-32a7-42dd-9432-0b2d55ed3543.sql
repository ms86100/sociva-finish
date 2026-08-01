-- Add AFTER INSERT trigger to cover COD orders (inserted directly as 'placed')
-- This restores the missing trigger that was dropped in migration 20260301064847
CREATE OR REPLACE TRIGGER trg_enqueue_order_notification_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.status IN ('placed', 'enquired'))
  EXECUTE FUNCTION public.fn_enqueue_order_status_notification();