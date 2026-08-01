
-- ============================================================
-- 1. Schema additions
-- ============================================================

ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS max_per_hour smallint NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS dynamic_multiplier_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.notification_engine_runs
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text;

-- ============================================================
-- 2. seller_performance_metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.seller_performance_metrics (
  seller_id uuid PRIMARY KEY REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  avg_response_seconds integer NOT NULL DEFAULT 0,
  missed_orders_count integer NOT NULL DEFAULT 0,
  escalation_hits integer NOT NULL DEFAULT 0,
  total_orders_30d integer NOT NULL DEFAULT 0,
  last_active_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_performance_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "spm_admin_read" ON public.seller_performance_metrics
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "spm_seller_read_own" ON public.seller_performance_metrics
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM public.seller_profiles sp
        WHERE sp.id = seller_performance_metrics.seller_id
          AND sp.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "spm_service_role_all" ON public.seller_performance_metrics
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. notification_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  rule_id uuid REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  rule_key text,
  queue_id uuid,
  user_id uuid,
  escalation_level smallint NOT NULL DEFAULT 0,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  action_taken text,
  status text NOT NULL DEFAULT 'queued',
  error text
);

CREATE INDEX IF NOT EXISTS idx_nal_entity ON public.notification_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_nal_rule ON public.notification_audit_log (rule_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nal_user ON public.notification_audit_log (user_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nal_queue ON public.notification_audit_log (queue_id);

ALTER TABLE public.notification_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "nal_admin_read" ON public.notification_audit_log
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "nal_service_role_all" ON public.notification_audit_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. fn_check_rate_limit
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_check_rate_limit(
  _entity_type text,
  _entity_id uuid,
  _max_per_hour integer
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _count integer;
BEGIN
  IF _max_per_hour IS NULL OR _max_per_hour <= 0 THEN
    RETURN true;
  END IF;
  SELECT COUNT(*) INTO _count
  FROM public.notification_audit_log
  WHERE entity_type = _entity_type
    AND entity_id = _entity_id
    AND triggered_at > now() - interval '1 hour';
  RETURN _count < _max_per_hour;
END;
$$;

-- ============================================================
-- 5. fn_validate_state_for_rule
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_validate_state_for_rule(
  _rule_id uuid,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.notification_rules%ROWTYPE;
  _current text;
BEGIN
  SELECT * INTO r FROM public.notification_rules WHERE id = _rule_id;
  IF NOT FOUND OR NOT r.active THEN RETURN false; END IF;

  IF r.entity_type = 'order' THEN
    SELECT status INTO _current FROM public.orders WHERE id = _entity_id;
    IF NOT FOUND THEN RETURN false; END IF;
    RETURN _current = r.trigger_status;
  ELSIF r.entity_type = 'delivery' THEN
    -- trigger_status maps stall_1 -> 1, stall_2 -> 2
    DECLARE _level smallint;
    BEGIN
      SELECT stall_level INTO _level FROM public.delivery_assignments WHERE id = _entity_id;
      IF NOT FOUND THEN RETURN false; END IF;
      IF r.trigger_status = 'stall_2' THEN RETURN _level = 2; END IF;
      IF r.trigger_status = 'stall_1' THEN RETURN _level = 1; END IF;
      RETURN false;
    END;
  END IF;

  -- For other entity types (refund, dispute, support_ticket) skip strict validation for now
  RETURN true;
END;
$$;

-- ============================================================
-- 6. fn_render_template_safe
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_render_template_safe(_template_key text, _vars jsonb)
RETURNS TABLE(title text, body text, channel text, tone text, fallback boolean)
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
    title := 'Order update';
    body := 'Please open the app to check your order.';
    channel := 'both';
    tone := 'info';
    fallback := true;
    RETURN NEXT;
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
  -- Strip unresolved placeholders to keep copy clean
  _title := regexp_replace(_title, '\{\{[^}]+\}\}', '', 'g');
  _body  := regexp_replace(_body,  '\{\{[^}]+\}\}', '', 'g');
  title := _title; body := _body; channel := t.channel; tone := t.tone; fallback := false;
  RETURN NEXT;
END;
$$;

-- ============================================================
-- 7. fn_enqueue_from_rule v2 — adds rate limit, state validation,
--    dynamic multiplier, audit log entry, safe rendering
-- ============================================================
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
  _seller_id uuid;
  _multiplier numeric := 1.0;
  _effective_repeat integer;
BEGIN
  SELECT * INTO r FROM public.notification_rules WHERE id = _rule_id AND active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _target_user_id IS NULL THEN RETURN NULL; END IF;

  -- State validation: skip stale notifications
  IF NOT public.fn_validate_state_for_rule(_rule_id, _entity_id) THEN
    RETURN NULL;
  END IF;

  -- Rate limit per entity per hour
  IF NOT public.fn_check_rate_limit(r.entity_type, _entity_id, r.max_per_hour) THEN
    RETURN NULL;
  END IF;

  -- Dynamic multiplier for slow sellers (only for order rules targeting seller)
  IF r.dynamic_multiplier_enabled AND r.entity_type = 'order' AND r.target_actor = 'seller' THEN
    SELECT o.seller_id INTO _seller_id FROM public.orders o WHERE o.id = _entity_id;
    IF _seller_id IS NOT NULL THEN
      SELECT GREATEST(0.5, 1.0 - LEAST(escalation_hits::numeric / 100.0, 0.5))
        INTO _multiplier
      FROM public.seller_performance_metrics
      WHERE seller_id = _seller_id;
      IF _multiplier IS NULL THEN _multiplier := 1.0; END IF;
    END IF;
  END IF;

  _dedupe := r.entity_type || ':' || _entity_id::text || ':' || r.id::text || ':' || r.escalation_level::text;

  SELECT * INTO state_row FROM public.notification_state_tracker WHERE dedupe_key = _dedupe;

  IF FOUND THEN
    IF state_row.completed THEN RETURN NULL; END IF;
    IF r.repeat_interval_seconds IS NULL OR r.max_repeats <= 0 THEN RETURN NULL; END IF;
    IF state_row.send_count >= (r.max_repeats + 1) THEN RETURN NULL; END IF;
    _effective_repeat := GREATEST(30, (r.repeat_interval_seconds * _multiplier)::integer);
    IF now() - state_row.last_triggered_at < make_interval(secs => _effective_repeat) THEN RETURN NULL; END IF;
    _queue_dedupe := _dedupe || ':rep:' || (state_row.send_count)::text;
  ELSE
    _queue_dedupe := _dedupe || ':first';
  END IF;

  SELECT * INTO rendered FROM public.fn_render_template_safe(r.template_key, _vars);

  _payload := COALESCE(r.payload_extra,'{}'::jsonb) || jsonb_build_object(
    'rule_key', r.key,
    'entity_type', r.entity_type,
    'entity_id', _entity_id,
    'target_role', r.target_actor,
    'escalation_level', r.escalation_level,
    'tone', rendered.tone,
    'priority', r.priority,
    'fallback_template', rendered.fallback
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

  -- Audit
  INSERT INTO public.notification_audit_log (
    entity_type, entity_id, rule_id, rule_key, queue_id, user_id,
    escalation_level, status
  ) VALUES (
    r.entity_type, _entity_id, r.id, r.key, _queue_id, _target_user_id,
    r.escalation_level, 'queued'
  );

  -- Update seller escalation_hits for L>=3
  IF r.entity_type = 'order' AND r.target_actor = 'seller' AND r.escalation_level >= 3 AND _seller_id IS NULL THEN
    SELECT o.seller_id INTO _seller_id FROM public.orders o WHERE o.id = _entity_id;
  END IF;
  IF _seller_id IS NOT NULL AND r.target_actor = 'seller' AND r.escalation_level >= 3 THEN
    INSERT INTO public.seller_performance_metrics (seller_id, escalation_hits, updated_at)
    VALUES (_seller_id, 1, now())
    ON CONFLICT (seller_id) DO UPDATE
      SET escalation_hits = public.seller_performance_metrics.escalation_hits + 1,
          updated_at = now();
  END IF;

  RETURN _queue_id;
END;
$$;

-- ============================================================
-- 8. fn_mark_notification_delivered / read
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_mark_notification_delivered(_queue_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_audit_log
    SET delivered_at = COALESCE(delivered_at, now()), status = 'delivered'
  WHERE queue_id = _queue_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_notification_read(_queue_id uuid, _action text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_audit_log
    SET read_at = COALESCE(read_at, now()),
        action_taken = COALESCE(_action, action_taken),
        status = 'read'
  WHERE queue_id = _queue_id;
$$;
