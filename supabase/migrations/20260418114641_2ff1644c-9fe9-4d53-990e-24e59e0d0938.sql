-- ============================================================
-- NOTIFICATION & COMMUNICATION ENGINE
-- ============================================================

-- 1. notification_templates
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  title_template text NOT NULL,
  body_template text NOT NULL,
  channel text NOT NULL DEFAULT 'both' CHECK (channel IN ('push','in_app','both','sms','email')),
  tone text NOT NULL DEFAULT 'info' CHECK (tone IN ('info','warning','urgent')),
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_read_authenticated" ON public.notification_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "templates_admin_write" ON public.notification_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. notification_rules
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  entity_type text NOT NULL CHECK (entity_type IN ('order','delivery','refund','dispute','support_ticket')),
  trigger_status text NOT NULL,
  delay_seconds integer NOT NULL DEFAULT 0,
  repeat_interval_seconds integer,
  max_repeats integer NOT NULL DEFAULT 0,
  escalation_level smallint NOT NULL DEFAULT 1,
  target_actor text NOT NULL CHECK (target_actor IN ('buyer','seller','admin','rider')),
  template_key text NOT NULL REFERENCES public.notification_templates(key) ON UPDATE CASCADE,
  payload_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority smallint NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_active_entity
  ON public.notification_rules (entity_type, trigger_status) WHERE active = true;

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules_read_authenticated" ON public.notification_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rules_admin_write" ON public.notification_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3. notification_state_tracker
CREATE TABLE IF NOT EXISTS public.notification_state_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.notification_rules(id) ON DELETE CASCADE,
  escalation_level smallint NOT NULL DEFAULT 1,
  last_triggered_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nst_entity ON public.notification_state_tracker (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_nst_rule_completed ON public.notification_state_tracker (rule_id, completed);

ALTER TABLE public.notification_state_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nst_admin_read" ON public.notification_state_tracker
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. notification_engine_runs (audit)
CREATE TABLE IF NOT EXISTS public.notification_engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rules_evaluated integer NOT NULL DEFAULT 0,
  entities_scanned integer NOT NULL DEFAULT 0,
  notifications_enqueued integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.notification_engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "engine_runs_admin_read" ON public.notification_engine_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 5. orders.status_changed_at
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

UPDATE public.orders SET status_changed_at = COALESCE(updated_at, created_at, now())
  WHERE status_changed_at = created_at;

CREATE OR REPLACE FUNCTION public.fn_orders_touch_status_changed_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_status_changed_at ON public.orders;
CREATE TRIGGER trg_orders_status_changed_at
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_orders_touch_status_changed_at();

CREATE INDEX IF NOT EXISTS idx_orders_status_changed_at
  ON public.orders (status, status_changed_at);

-- 6. delivery_assignments stall fields
ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS stall_level smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stall_changed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_stall
  ON public.delivery_assignments (stall_level, stall_changed_at) WHERE stall_level > 0;

-- 7. notification_queue extensions
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS escalation_level smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_dedupe_key
  ON public.notification_queue (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 8. fn_render_template
CREATE OR REPLACE FUNCTION public.fn_render_template(_template_key text, _vars jsonb)
RETURNS TABLE(title text, body text, channel text, tone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.notification_templates%ROWTYPE;
  k text;
  v text;
  _title text;
  _body text;
BEGIN
  SELECT * INTO t FROM public.notification_templates WHERE key = _template_key AND active = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  _title := t.title_template;
  _body := t.body_template;
  IF _vars IS NOT NULL THEN
    FOR k, v IN SELECT * FROM jsonb_each_text(_vars) LOOP
      _title := replace(_title, '{{'||k||'}}', COALESCE(v,''));
      _body  := replace(_body,  '{{'||k||'}}', COALESCE(v,''));
    END LOOP;
  END IF;
  title := _title; body := _body; channel := t.channel; tone := t.tone;
  RETURN NEXT;
END;
$$;

-- 9. fn_enqueue_from_rule
CREATE OR REPLACE FUNCTION public.fn_enqueue_from_rule(
  _rule_id uuid,
  _entity_id uuid,
  _target_user_id uuid,
  _vars jsonb DEFAULT '{}'::jsonb,
  _reference_path text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.notification_rules%ROWTYPE;
  rendered RECORD;
  state_row public.notification_state_tracker%ROWTYPE;
  _dedupe text;
  _queue_dedupe text;
  _queue_id uuid;
  _payload jsonb;
BEGIN
  SELECT * INTO r FROM public.notification_rules WHERE id = _rule_id AND active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _target_user_id IS NULL THEN RETURN NULL; END IF;

  _dedupe := r.entity_type || ':' || _entity_id::text || ':' || r.id::text || ':' || r.escalation_level::text;

  SELECT * INTO state_row FROM public.notification_state_tracker WHERE dedupe_key = _dedupe;

  IF FOUND THEN
    -- Already fired at least once. Check repeat eligibility.
    IF state_row.completed THEN RETURN NULL; END IF;
    IF r.repeat_interval_seconds IS NULL OR r.max_repeats <= 0 THEN RETURN NULL; END IF;
    IF state_row.send_count >= (r.max_repeats + 1) THEN RETURN NULL; END IF;
    IF now() - state_row.last_triggered_at < make_interval(secs => r.repeat_interval_seconds) THEN RETURN NULL; END IF;
    _queue_dedupe := _dedupe || ':rep:' || (state_row.send_count)::text;
  ELSE
    _queue_dedupe := _dedupe || ':first';
  END IF;

  SELECT * INTO rendered FROM public.fn_render_template(r.template_key, _vars);
  IF rendered.title IS NULL THEN RETURN NULL; END IF;

  _payload := COALESCE(r.payload_extra,'{}'::jsonb) || jsonb_build_object(
    'rule_key', r.key,
    'entity_type', r.entity_type,
    'entity_id', _entity_id,
    'target_role', r.target_actor,
    'escalation_level', r.escalation_level,
    'tone', rendered.tone,
    'priority', r.priority
  );

  BEGIN
    INSERT INTO public.notification_queue (
      user_id, title, body, type, reference_path, payload,
      rule_id, dedupe_key, escalation_level
    ) VALUES (
      _target_user_id, rendered.title, rendered.body,
      COALESCE(r.payload_extra->>'type','lifecycle_nudge'),
      _reference_path, _payload,
      r.id, _queue_dedupe, r.escalation_level
    )
    RETURNING id INTO _queue_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;

  INSERT INTO public.notification_state_tracker (
    entity_type, entity_id, rule_id, escalation_level,
    last_triggered_at, send_count, dedupe_key, payload
  ) VALUES (
    r.entity_type, _entity_id, r.id, r.escalation_level,
    now(), 1, _dedupe, _vars
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET last_triggered_at = now(),
        send_count = public.notification_state_tracker.send_count + 1,
        updated_at = now();

  RETURN _queue_id;
END;
$$;

-- 10. updated_at triggers
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_templates_touch ON public.notification_templates;
CREATE TRIGGER trg_templates_touch BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_rules_touch ON public.notification_rules;
CREATE TRIGGER trg_rules_touch BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_nst_touch ON public.notification_state_tracker;
CREATE TRIGGER trg_nst_touch BEFORE UPDATE ON public.notification_state_tracker
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- ============================================================
-- SEED TEMPLATES
-- ============================================================
INSERT INTO public.notification_templates (key, title_template, body_template, channel, tone, variables, description) VALUES
  ('order_placed_seller_l1','New order #{{order_short}}','You have a new order. Please accept to start preparing.','both','info','["order_short"]','Soft nudge after 2m'),
  ('order_placed_seller_l2','⏰ Order #{{order_short}} still waiting','Buyer is waiting. Please accept the order now.','both','warning','["order_short"]','Stronger nudge'),
  ('order_placed_seller_l3','⚠️ Final reminder for order #{{order_short}}','Accept now or this order will be auto-cancelled soon.','both','urgent','["order_short"]','Last warning'),
  ('order_placed_seller_l4','🚨 Order #{{order_short}} cancels in 2 minutes','Accept immediately or the order will be auto-cancelled.','both','urgent','["order_short"]','Final warning before cancel'),
  ('order_placed_buyer_reassure','We''re checking with the seller','Your order #{{order_short}} hasn''t been accepted yet. We''re nudging the seller.','both','info','["order_short"]','Buyer reassurance'),
  ('order_accepted_no_progress_l1','Start preparing order #{{order_short}}','Buyer is waiting for you to begin preparation.','both','info','["order_short"]',null),
  ('order_accepted_no_progress_l2','⏰ Order #{{order_short}} delay detected','Please update the order status.','both','warning','["order_short"]',null),
  ('order_preparing_slow_l1','Order #{{order_short}} taking long','Please mark as ready when done.','both','info','["order_short"]',null),
  ('order_ready_pickup_l1','Order #{{order_short}} ready for pickup','Please hand over or dispatch the order.','both','warning','["order_short"]',null),
  ('delivery_stalled_seller_l1','📍 Tracking paused for order #{{order_short}}','Please keep the app open while delivering.','both','warning','["order_short"]',null),
  ('delivery_stalled_seller_l2','🚨 Tracking stopped for order #{{order_short}}','Update delivery status or open the app.','both','urgent','["order_short"]',null),
  ('delivery_stalled_buyer_l1','We''re checking on your delivery','Live tracking paused briefly. Delivery is still in progress.','both','info','["order_short"]',null)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SEED RULES
-- ============================================================
INSERT INTO public.notification_rules
  (key, entity_type, trigger_status, delay_seconds, repeat_interval_seconds, max_repeats, escalation_level, target_actor, template_key, priority, payload_extra, description)
VALUES
  ('order_placed_seller_l1','order','placed', 120, NULL, 0, 1,'seller','order_placed_seller_l1', 5,'{"type":"order_lifecycle","action":"Accept Order"}','Soft nudge after 2 minutes'),
  ('order_placed_seller_l2','order','placed', 300, NULL, 0, 2,'seller','order_placed_seller_l2', 7,'{"type":"order_lifecycle","action":"Accept Order"}','Warning at 5 minutes'),
  ('order_placed_seller_l3','order','placed', 600, NULL, 0, 3,'seller','order_placed_seller_l3', 9,'{"type":"order_lifecycle","action":"Accept Order"}','Urgent at 10 minutes'),
  ('order_placed_seller_l4','order','placed',1680, NULL, 0, 4,'seller','order_placed_seller_l4',10,'{"type":"order_lifecycle","action":"Accept Order"}','Final at 28 minutes'),
  ('order_placed_buyer_reassure','order','placed', 360, NULL, 0, 2,'buyer','order_placed_buyer_reassure', 4,'{"type":"order_lifecycle"}','Reassure buyer at 6 minutes'),
  ('order_accepted_no_progress_l1','order','accepted', 180, NULL, 0, 1,'seller','order_accepted_no_progress_l1', 5,'{"type":"order_lifecycle","action":"Start Preparing"}',null),
  ('order_accepted_no_progress_l2','order','accepted', 600, NULL, 0, 2,'seller','order_accepted_no_progress_l2', 7,'{"type":"order_lifecycle","action":"Start Preparing"}',null),
  ('order_preparing_slow_l1','order','preparing', 600, NULL, 0, 1,'seller','order_preparing_slow_l1', 5,'{"type":"order_lifecycle","action":"Mark Ready"}',null),
  ('order_ready_pickup_l1','order','ready', 300, NULL, 0, 2,'seller','order_ready_pickup_l1', 7,'{"type":"order_lifecycle","action":"Dispatch"}',null),
  ('delivery_stalled_seller_l1','delivery','stall_1', 0, NULL, 0, 1,'seller','delivery_stalled_seller_l1', 6,'{"type":"delivery_issue","action":"Open App"}','Soft GPS stall'),
  ('delivery_stalled_seller_l2','delivery','stall_2', 0, NULL, 0, 2,'seller','delivery_stalled_seller_l2', 9,'{"type":"delivery_issue","action":"Update Status"}','Hard GPS stall'),
  ('delivery_stalled_buyer_l1','delivery','stall_1', 0, NULL, 0, 1,'buyer','delivery_stalled_buyer_l1', 4,'{"type":"delivery_issue"}','Buyer reassure on stall')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SETTINGS for auto-cancel grace
-- ============================================================
INSERT INTO public.system_settings (key, value, description) VALUES
  ('auto_cancel_grace_online_seconds','1800','Seconds before unaccepted online order is auto-cancelled'),
  ('auto_cancel_grace_urgent_seconds','180','Seconds before unaccepted urgent order is auto-cancelled')
ON CONFLICT (key) DO NOTHING;