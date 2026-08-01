
-- Phase 1: Backend Feature Flag Enforcement
-- Step 1: Create helper function
CREATE OR REPLACE FUNCTION public.can_access_feature(_feature_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_feature_enabled_for_society(
    public.get_user_society_id(auth.uid()),
    _feature_key
  )
$$;

-- Step 2: RESTRICTIVE write-blocking policies

-- snag_management -> snag_tickets
CREATE POLICY "feature_gate_snag_tickets_insert" ON public.snag_tickets AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('snag_management'));
CREATE POLICY "feature_gate_snag_tickets_update" ON public.snag_tickets AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('snag_management'));
CREATE POLICY "feature_gate_snag_tickets_delete" ON public.snag_tickets AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('snag_management'));

-- disputes -> dispute_tickets
CREATE POLICY "feature_gate_dispute_tickets_insert" ON public.dispute_tickets AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('disputes'));
CREATE POLICY "feature_gate_dispute_tickets_update" ON public.dispute_tickets AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('disputes'));
CREATE POLICY "feature_gate_dispute_tickets_delete" ON public.dispute_tickets AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('disputes'));

-- disputes -> dispute_comments
CREATE POLICY "feature_gate_dispute_comments_insert" ON public.dispute_comments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('disputes'));
CREATE POLICY "feature_gate_dispute_comments_update" ON public.dispute_comments AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('disputes'));
CREATE POLICY "feature_gate_dispute_comments_delete" ON public.dispute_comments AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('disputes'));

-- bulletin -> bulletin_posts
CREATE POLICY "feature_gate_bulletin_posts_insert" ON public.bulletin_posts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_posts_update" ON public.bulletin_posts AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_posts_delete" ON public.bulletin_posts AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- bulletin -> bulletin_comments
CREATE POLICY "feature_gate_bulletin_comments_insert" ON public.bulletin_comments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_comments_update" ON public.bulletin_comments AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_comments_delete" ON public.bulletin_comments AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- bulletin -> bulletin_votes
CREATE POLICY "feature_gate_bulletin_votes_insert" ON public.bulletin_votes AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_votes_delete" ON public.bulletin_votes AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- bulletin -> bulletin_rsvps
CREATE POLICY "feature_gate_bulletin_rsvps_insert" ON public.bulletin_rsvps AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_rsvps_update" ON public.bulletin_rsvps AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_bulletin_rsvps_delete" ON public.bulletin_rsvps AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- bulletin -> help_requests
CREATE POLICY "feature_gate_help_requests_insert" ON public.help_requests AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_help_requests_update" ON public.help_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_help_requests_delete" ON public.help_requests AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- bulletin -> help_responses
CREATE POLICY "feature_gate_help_responses_insert" ON public.help_responses AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_help_responses_update" ON public.help_responses AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('bulletin'));
CREATE POLICY "feature_gate_help_responses_delete" ON public.help_responses AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('bulletin'));

-- finances -> society_expenses
CREATE POLICY "feature_gate_society_expenses_insert" ON public.society_expenses AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('finances'));
CREATE POLICY "feature_gate_society_expenses_update" ON public.society_expenses AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('finances'));
CREATE POLICY "feature_gate_society_expenses_delete" ON public.society_expenses AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('finances'));

-- maintenance -> maintenance_dues
CREATE POLICY "feature_gate_maintenance_dues_insert" ON public.maintenance_dues AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('maintenance'));
CREATE POLICY "feature_gate_maintenance_dues_update" ON public.maintenance_dues AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('maintenance'));
CREATE POLICY "feature_gate_maintenance_dues_delete" ON public.maintenance_dues AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('maintenance'));

-- construction_progress -> construction_milestones
CREATE POLICY "feature_gate_construction_milestones_insert" ON public.construction_milestones AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('construction_progress'));
CREATE POLICY "feature_gate_construction_milestones_update" ON public.construction_milestones AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('construction_progress'));
CREATE POLICY "feature_gate_construction_milestones_delete" ON public.construction_milestones AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('construction_progress'));

-- visitor_management -> visitor_entries
CREATE POLICY "feature_gate_visitor_entries_insert" ON public.visitor_entries AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('visitor_management'));
CREATE POLICY "feature_gate_visitor_entries_update" ON public.visitor_entries AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('visitor_management'));

-- visitor_management -> authorized_persons
CREATE POLICY "feature_gate_authorized_persons_insert" ON public.authorized_persons AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('visitor_management'));
CREATE POLICY "feature_gate_authorized_persons_update" ON public.authorized_persons AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('visitor_management'));
CREATE POLICY "feature_gate_authorized_persons_delete" ON public.authorized_persons AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('visitor_management'));

-- workforce_management -> society_workers
CREATE POLICY "feature_gate_society_workers_insert" ON public.society_workers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('workforce_management'));
CREATE POLICY "feature_gate_society_workers_update" ON public.society_workers AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('workforce_management'));
CREATE POLICY "feature_gate_society_workers_delete" ON public.society_workers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('workforce_management'));

-- workforce_management -> worker_flat_assignments
CREATE POLICY "feature_gate_worker_flat_assignments_insert" ON public.worker_flat_assignments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('workforce_management'));
CREATE POLICY "feature_gate_worker_flat_assignments_update" ON public.worker_flat_assignments AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('workforce_management'));
CREATE POLICY "feature_gate_worker_flat_assignments_delete" ON public.worker_flat_assignments AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('workforce_management'));

-- worker_marketplace -> worker_job_requests
CREATE POLICY "feature_gate_worker_job_requests_insert" ON public.worker_job_requests AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_access_feature('worker_marketplace'));
CREATE POLICY "feature_gate_worker_job_requests_update" ON public.worker_job_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_access_feature('worker_marketplace'));
CREATE POLICY "feature_gate_worker_job_requests_delete" ON public.worker_job_requests AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_access_feature('worker_marketplace'));
