-- Allow service_role full access to notification engine tables
-- (cron-invoked edge functions authenticate with service role key)

DO $$ BEGIN
  CREATE POLICY "rules_service_role_all" ON public.notification_rules
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "templates_service_role_all" ON public.notification_templates
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "nst_service_role_all" ON public.notification_state_tracker
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "engine_runs_service_role_all" ON public.notification_engine_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;