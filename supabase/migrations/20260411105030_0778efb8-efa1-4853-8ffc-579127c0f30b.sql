
-- 1. Backfill society_id
UPDATE seller_profiles SET society_id = 'a0000000-0000-0000-0000-000000000001' WHERE society_id IS NULL;
UPDATE profiles SET society_id = 'a0000000-0000-0000-0000-000000000001' WHERE society_id IS NULL;
UPDATE orders SET society_id = 'a0000000-0000-0000-0000-000000000001' WHERE society_id IS NULL;
UPDATE payment_records SET society_id = 'a0000000-0000-0000-0000-000000000001' WHERE society_id IS NULL;

-- 2. Add UNIQUE constraint on payment_records(order_id) if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_records_order_id_unique') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_order_id_unique UNIQUE (order_id);
  END IF;
END $$;

-- 3. Remove duplicate updated_at trigger
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;

-- 4. Create trigger_errors table if not exists
CREATE TABLE IF NOT EXISTS public.trigger_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  trigger_name text NOT NULL,
  row_id uuid,
  error_message text NOT NULL,
  error_detail text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trigger_errors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trigger_errors' AND policyname = 'Service role full access on trigger_errors') THEN
    CREATE POLICY "Service role full access on trigger_errors" ON public.trigger_errors FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trigger_errors_created_at ON public.trigger_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_errors_table_trigger ON public.trigger_errors (table_name, trigger_name);

-- 5. Fix set_order_society_id
CREATE OR REPLACE FUNCTION public.set_order_society_id()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.society_id IS NULL AND NEW.seller_id IS NOT NULL THEN
    SELECT society_id INTO NEW.society_id FROM public.seller_profiles WHERE id = NEW.seller_id;
  END IF;
  IF NEW.society_id IS NULL AND NEW.buyer_id IS NOT NULL THEN
    SELECT society_id INTO NEW.society_id FROM public.profiles WHERE id = NEW.buyer_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. Create _impl wrapper functions for consolidated triggers

CREATE OR REPLACE FUNCTION public.fn_populate_payment_record_impl(p_old orders, p_new orders)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_collection text;
  v_payment_mode text;
  v_existing_payment_record_id uuid;
BEGIN
  IF p_new.payment_status IS DISTINCT FROM p_old.payment_status
     AND p_new.payment_status IN ('buyer_confirmed', 'paid', 'completed', 'seller_verified')
  THEN
    v_payment_collection := CASE WHEN COALESCE(p_new.payment_type, 'cod') = 'cod' THEN 'doorstep' ELSE 'online' END;
    v_payment_mode := CASE
      WHEN COALESCE(p_new.payment_type, 'cod') = 'cod' THEN 'cod'
      WHEN p_new.payment_type IN ('upi', 'card', 'wallet', 'razorpay') THEN p_new.payment_type
      WHEN p_new.razorpay_payment_id IS NOT NULL THEN 'razorpay'
      ELSE 'online'
    END;

    SELECT pr.id INTO v_existing_payment_record_id
    FROM public.payment_records pr WHERE pr.order_id = p_new.id
    ORDER BY pr.created_at ASC, pr.id ASC LIMIT 1;

    IF v_existing_payment_record_id IS NOT NULL THEN
      UPDATE public.payment_records
      SET buyer_id = p_new.buyer_id, seller_id = p_new.seller_id,
          amount = p_new.total_amount, payment_method = COALESCE(p_new.payment_type, 'cod'),
          payment_status = p_new.payment_status,
          transaction_reference = COALESCE(p_new.razorpay_payment_id, transaction_reference),
          society_id = COALESCE(society_id, p_new.society_id),
          payment_mode = v_payment_mode, payment_collection = v_payment_collection,
          razorpay_payment_id = COALESCE(p_new.razorpay_payment_id, razorpay_payment_id),
          idempotency_key = COALESCE(idempotency_key, 'pay_' || p_new.id || '_' || p_new.payment_status),
          updated_at = now()
      WHERE id = v_existing_payment_record_id;
    ELSE
      INSERT INTO public.payment_records (order_id, buyer_id, seller_id, amount, payment_method, payment_status, transaction_reference, society_id, payment_mode, payment_collection, razorpay_payment_id, idempotency_key)
      VALUES (p_new.id, p_new.buyer_id, p_new.seller_id, p_new.total_amount, COALESCE(p_new.payment_type, 'cod'), p_new.payment_status, p_new.razorpay_payment_id, p_new.society_id, v_payment_mode, v_payment_collection, p_new.razorpay_payment_id, 'pay_' || p_new.id || '_' || p_new.payment_status);
    END IF;
  END IF;

  IF p_new.payment_status IS DISTINCT FROM p_old.payment_status
     AND p_new.payment_status IN ('refund_initiated', 'refund_processing', 'refunded')
  THEN
    UPDATE public.payment_records SET payment_status = p_new.payment_status, updated_at = now() WHERE order_id = p_new.id;
  END IF;
END;
$function$;

-- Stub _impl functions for triggers we haven't refactored yet (they remain as original triggers)
CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.sync_order_to_delivery_assignment_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.generate_delivery_code_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.trg_auto_assign_delivery_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.trg_create_seller_delivery_assignment_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.sync_booking_status_on_order_update_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.fn_enqueue_review_prompt_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.auto_dismiss_delivery_notifications_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.trg_audit_order_status_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.log_order_activity_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.trigger_recompute_seller_stats_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.trg_update_seller_stats_on_order_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;
CREATE OR REPLACE FUNCTION public.log_reputation_on_order_impl(p_old orders, p_new orders) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$;

-- 7. Create consolidated trigger functions
CREATE OR REPLACE FUNCTION public.trg_orders_after_update_critical()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status THEN RETURN NEW; END IF;

  BEGIN PERFORM fn_populate_payment_record_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'populate_payment_record', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM create_settlement_on_delivery_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'create_settlement', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM restore_stock_on_cancel_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'restore_stock', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM sync_order_to_delivery_assignment_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'sync_delivery', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM generate_delivery_code_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'generate_delivery_code', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM trg_auto_assign_delivery_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'auto_assign_delivery', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM trg_create_seller_delivery_assignment_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'create_seller_delivery', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  BEGIN PERFORM sync_booking_status_on_order_update_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'sync_booking', NEW.id, SQLERRM, SQLSTATE); RAISE; END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_orders_after_update_non_critical()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status THEN RETURN NEW; END IF;

  BEGIN PERFORM fn_enqueue_order_status_notification_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'notification', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM fn_enqueue_review_prompt_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'review_prompt', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM auto_dismiss_delivery_notifications_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'dismiss_notif', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM trg_audit_order_status_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'audit_status', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM log_order_activity_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'log_activity', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM trigger_recompute_seller_stats_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'recompute_stats', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM trg_update_seller_stats_on_order_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'update_stats', NEW.id, SQLERRM, SQLSTATE); END;

  BEGIN PERFORM log_reputation_on_order_impl(OLD, NEW);
  EXCEPTION WHEN OTHERS THEN INSERT INTO trigger_errors (table_name, trigger_name, row_id, error_message, error_detail) VALUES ('orders', 'log_reputation', NEW.id, SQLERRM, SQLSTATE); END;

  RETURN NEW;
END;
$function$;
