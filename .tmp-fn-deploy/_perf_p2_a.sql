-- Phase 2: status-gate hot order triggers, portfolio aggregate RPCs, more RLS initplan.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Status-gate ANY-UPDATE triggers that only care about status changes
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_audit_order_status ON public.orders;
CREATE TRIGGER trg_audit_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_audit_order_status();

DROP TRIGGER IF EXISTS trg_auto_assign_delivery ON public.orders;
CREATE TRIGGER trg_auto_assign_delivery
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_auto_assign_delivery();

DROP TRIGGER IF EXISTS trg_auto_refund_on_seller_cancel ON public.orders;
CREATE TRIGGER trg_auto_refund_on_seller_cancel
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_auto_refund_on_seller_cancel();

DROP TRIGGER IF EXISTS trg_compute_delivery_eta ON public.orders;
CREATE TRIGGER trg_compute_delivery_eta
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_compute_delivery_eta();

DROP TRIGGER IF EXISTS trg_create_seller_delivery_assignment ON public.orders;
CREATE TRIGGER trg_create_seller_delivery_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_create_seller_delivery_assignment();

DROP TRIGGER IF EXISTS trg_enqueue_review_prompt ON public.orders;
CREATE TRIGGER trg_enqueue_review_prompt
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_enqueue_review_prompt();

DROP TRIGGER IF EXISTS trg_generate_delivery_code ON public.orders;
CREATE TRIGGER trg_generate_delivery_code
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION generate_delivery_code();

DROP TRIGGER IF EXISTS trg_log_reputation_on_order ON public.orders;
CREATE TRIGGER trg_log_reputation_on_order
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_reputation_on_order();

DROP TRIGGER IF EXISTS trg_order_status_seller_stats ON public.orders;
CREATE TRIGGER trg_order_status_seller_stats
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_update_seller_stats_on_order();

DROP TRIGGER IF EXISTS trg_set_order_ready_at ON public.orders;
CREATE TRIGGER trg_set_order_ready_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION set_order_ready_at();

DROP TRIGGER IF EXISTS trg_sync_booking_status ON public.orders;
CREATE TRIGGER trg_sync_booking_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_booking_status_on_order_update();

DROP TRIGGER IF EXISTS trg_sync_order_to_delivery_assignment ON public.orders;
CREATE TRIGGER trg_sync_order_to_delivery_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_order_to_delivery_assignment();

-- log_order_activity: keep INSERT always; gate UPDATE half via replace
DROP TRIGGER IF EXISTS trg_log_order_activity ON public.orders;
CREATE TRIGGER trg_log_order_activity_ins
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION log_order_activity();
CREATE TRIGGER trg_log_order_activity_upd
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_order_activity();

-- Payment record: gate on payment_status change (not every column touch)
DROP TRIGGER IF EXISTS trg_populate_payment_record ON public.orders;
CREATE TRIGGER trg_populate_payment_record
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION fn_populate_payment_record();

-- Add WHEN to UPDATE OF status triggers that lacked it
DROP TRIGGER IF EXISTS trg_earn_loyalty_on_delivery ON public.orders;
CREATE TRIGGER trg_earn_loyalty_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_earn_loyalty_on_delivery();

DROP TRIGGER IF EXISTS trg_loyalty_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_loyalty_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_loyalty_on_order_cancelled();

DROP TRIGGER IF EXISTS trg_restore_stock_on_order_cancel ON public.orders;
CREATE TRIGGER trg_restore_stock_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION restore_stock_on_order_cancel();

DROP TRIGGER IF EXISTS trg_update_reliability_on_order ON public.orders;
CREATE TRIGGER trg_update_reliability_on_order
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_update_reliability_on_order_change();

DROP TRIGGER IF EXISTS trg_wallet_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_wallet_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_wallet_on_order_cancelled();

DROP TRIGGER IF EXISTS trg_recompute_seller_stats ON public.orders;
CREATE TRIGGER trg_recompute_seller_stats
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trigger_recompute_seller_stats();

DROP TRIGGER IF EXISTS trg_create_review_prompt ON public.orders;
CREATE TRIGGER trg_create_review_prompt
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_create_review_prompt();

DROP TRIGGER IF EXISTS trg_mark_order_notifications_read_on_terminal ON public.orders;
CREATE TRIGGER trg_mark_order_notifications_read_on_terminal
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_mark_order_notifications_read_on_terminal();

DROP TRIGGER IF EXISTS trg_auto_dismiss_delivery_notifications ON public.orders;
CREATE TRIGGER trg_auto_dismiss_delivery_notifications
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION auto_dismiss_delivery_notifications();

-- ═══════════════════════════════════════════════════════════════════════════
