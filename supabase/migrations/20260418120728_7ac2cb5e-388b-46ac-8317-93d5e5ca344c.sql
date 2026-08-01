-- service_role needs explicit insert/update policies for upsert to succeed under RLS
DO $$ BEGIN
  CREATE POLICY "spm_service_insert" ON public.seller_performance_metrics
    FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "spm_service_update" ON public.seller_performance_metrics
    FOR UPDATE TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Same hardening for audit log
DO $$ BEGIN
  CREATE POLICY "nal_service_insert" ON public.notification_audit_log
    FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "nal_service_update" ON public.notification_audit_log
    FOR UPDATE TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;