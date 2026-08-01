
-- Fix overly permissive INSERT policies for service-role-only tables
-- These tables should only be inserted by edge functions (service role)
-- Regular users should not be able to insert

DROP POLICY "Service role inserts escalations" ON public.collective_escalations;
DROP POLICY "Service role inserts reports" ON public.society_reports;

-- Restrict inserts to platform admins only (service role bypasses RLS anyway)
CREATE POLICY "Only admins can insert escalations"
  ON public.collective_escalations FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Only admins can insert reports"
  ON public.society_reports FOR INSERT
  WITH CHECK (is_admin(auth.uid()));
