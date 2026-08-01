
-- 1. Validate order status transitions (BEFORE UPDATE)
DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON public.orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.validate_order_status_transition();

-- 2. Enforce OTP gate (BEFORE UPDATE, after validation)
DROP TRIGGER IF EXISTS trg_enforce_otp_gate ON public.orders;
CREATE TRIGGER trg_enforce_otp_gate
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.enforce_otp_gate();

-- 3. Enqueue notification on status change (AFTER UPDATE)
DROP TRIGGER IF EXISTS trg_enqueue_order_status_notification ON public.orders;
CREATE TRIGGER trg_enqueue_order_status_notification
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_enqueue_order_status_notification();

-- 4. Enqueue notification on new order (AFTER INSERT)
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
CREATE TRIGGER trg_enqueue_new_order_notification
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_new_order_notification();

-- 5. Create settlement on delivery/completion (AFTER UPDATE)
DROP TRIGGER IF EXISTS trg_create_settlement_on_delivery ON public.orders;
CREATE TRIGGER trg_create_settlement_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('delivered', 'completed'))
  EXECUTE FUNCTION public.create_settlement_on_delivery();

-- Also check notification_queue trigger
DROP TRIGGER IF EXISTS trg_process_notification_queue ON public.notification_queue;
CREATE TRIGGER trg_process_notification_queue
  AFTER INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_process_notification_queue();
