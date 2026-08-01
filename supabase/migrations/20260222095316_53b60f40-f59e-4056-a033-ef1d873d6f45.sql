
-- ============================================================
-- DELIVERY INTEGRATION: Phase 1 - Database Schema
-- ============================================================

-- 1. delivery_partners table
CREATE TABLE public.delivery_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT '3pl',
  api_config jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_delivery_provider_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.provider_type NOT IN ('3pl', 'native') THEN
    RAISE EXCEPTION 'Invalid provider_type: %. Must be 3pl or native', NEW.provider_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_delivery_provider_type
  BEFORE INSERT OR UPDATE ON public.delivery_partners
  FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_provider_type();

CREATE TRIGGER update_delivery_partners_updated_at
  BEFORE UPDATE ON public.delivery_partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.delivery_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view delivery partners"
  ON public.delivery_partners FOR SELECT
  USING (
    society_id = public.get_user_society_id(auth.uid())
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "Admins can manage delivery partners"
  ON public.delivery_partners FOR INSERT
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

CREATE POLICY "Admins can update delivery partners"
  ON public.delivery_partners FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- 2. delivery_assignments table
CREATE TABLE public.delivery_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  partner_id uuid REFERENCES public.delivery_partners(id),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  rider_name text,
  rider_phone text,
  rider_photo_url text,
  status text NOT NULL DEFAULT 'pending',
  gate_entry_id uuid,
  otp_hash text,
  otp_expires_at timestamptz,
  delivery_fee numeric NOT NULL DEFAULT 0,
  partner_payout numeric NOT NULL DEFAULT 0,
  platform_margin numeric NOT NULL DEFAULT 0,
  pickup_at timestamptz,
  delivered_at timestamptz,
  failed_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  external_tracking_id text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_assignments_order_id_key UNIQUE (order_id),
  CONSTRAINT delivery_assignments_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX idx_delivery_assignments_society ON public.delivery_assignments(society_id);
CREATE INDEX idx_delivery_assignments_status ON public.delivery_assignments(status);
CREATE INDEX idx_delivery_assignments_partner ON public.delivery_assignments(partner_id);

CREATE OR REPLACE FUNCTION public.validate_delivery_assignment_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'assigned', 'picked_up', 'at_gate', 'delivered', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid delivery assignment status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_delivery_assignment_status
  BEFORE INSERT OR UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_assignment_status();

CREATE TRIGGER update_delivery_assignments_updated_at
  BEFORE UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relevant users can view delivery assignments"
  ON public.delivery_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
      AND (
        o.buyer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.seller_profiles sp WHERE sp.id = o.seller_id AND sp.user_id = auth.uid())
      )
    )
    OR public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- No INSERT/UPDATE policies - only service role (edge function) can write

-- 3. delivery_tracking_logs table
CREATE TABLE public.delivery_tracking_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id),
  status text NOT NULL,
  location_lat numeric,
  location_lng numeric,
  note text,
  source text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_tracking_assignment ON public.delivery_tracking_logs(assignment_id);

CREATE OR REPLACE FUNCTION public.validate_tracking_log_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.source NOT IN ('3pl_webhook', 'manual', 'system') THEN
    RAISE EXCEPTION 'Invalid tracking log source: %', NEW.source;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_tracking_log_source
  BEFORE INSERT OR UPDATE ON public.delivery_tracking_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_tracking_log_source();

ALTER TABLE public.delivery_tracking_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relevant users can view tracking logs"
  ON public.delivery_tracking_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_assignments da
      JOIN public.orders o ON o.id = da.order_id
      WHERE da.id = assignment_id
      AND (
        o.buyer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.seller_profiles sp WHERE sp.id = o.seller_id AND sp.user_id = auth.uid())
        OR public.is_admin(auth.uid())
        OR public.is_society_admin(auth.uid(), da.society_id)
      )
    )
  );

-- 4. Modify orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'self_pickup',
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.validate_order_fulfillment_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.fulfillment_type NOT IN ('self_pickup', 'delivery') THEN
    RAISE EXCEPTION 'Invalid fulfillment_type: %. Must be self_pickup or delivery', NEW.fulfillment_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_order_fulfillment_type
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_order_fulfillment_type();

-- 5. Auto-create delivery assignment trigger
CREATE OR REPLACE FUNCTION public.trg_auto_assign_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _buyer_society uuid;
  _idempotency text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'ready' THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type != 'delivery' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = NEW.buyer_id;
  _idempotency := 'delivery_' || NEW.id::text || '_' || extract(epoch from now())::text;

  INSERT INTO delivery_assignments (order_id, society_id, delivery_fee, idempotency_key)
  VALUES (NEW.id, COALESCE(_buyer_society, NEW.buyer_society_id), NEW.delivery_fee, _idempotency);

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT sp.user_id,
    '🚚 Delivery Assignment Created',
    'A delivery partner is being assigned for order #' || LEFT(NEW.id::text, 8),
    'delivery', '/orders/' || NEW.id::text,
    jsonb_build_object('orderId', NEW.id, 'type', 'delivery_created')
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_assign_delivery
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_assign_delivery();

-- 6. Delivery status notification trigger
CREATE OR REPLACE FUNCTION public.trg_notify_delivery_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _buyer_id uuid;
  _seller_user_id uuid;
  _title text;
  _body text;
  _order_short text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT o.buyer_id, sp.user_id INTO _buyer_id, _seller_user_id
  FROM orders o JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = NEW.order_id;

  _order_short := LEFT(NEW.order_id::text, 8);

  CASE NEW.status
    WHEN 'assigned' THEN
      _title := '🚚 Delivery Partner Assigned';
      _body := COALESCE(NEW.rider_name, 'A rider') || ' will deliver your order #' || _order_short;
    WHEN 'picked_up' THEN
      _title := '📦 Order Picked Up';
      _body := 'Your order #' || _order_short || ' is on the way!';
    WHEN 'at_gate' THEN
      _title := '🏠 Rider at Your Gate';
      _body := 'Delivery partner is at your society gate for order #' || _order_short;
    WHEN 'delivered' THEN
      _title := '✅ Order Delivered!';
      _body := 'Your order #' || _order_short || ' has been delivered successfully.';
    WHEN 'failed' THEN
      _title := '❌ Delivery Failed';
      _body := 'Delivery for order #' || _order_short || ' failed. ' || COALESCE(NEW.failed_reason, '');
    ELSE
      RETURN NEW;
  END CASE;

  IF _buyer_id IS NOT NULL AND _title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_buyer_id, _title, _body, 'delivery', '/orders/' || NEW.order_id::text,
      jsonb_build_object('orderId', NEW.order_id, 'deliveryStatus', NEW.status));
  END IF;

  IF NEW.status = 'failed' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '❌ Delivery Failed', 'Delivery for order #' || _order_short || ' failed.', 'delivery',
      '/orders/' || NEW.order_id::text, jsonb_build_object('orderId', NEW.order_id, 'deliveryStatus', 'failed'));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_delivery_status
  AFTER UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_delivery_status();

-- 7. Enable realtime for delivery_assignments
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_assignments;
