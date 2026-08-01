
-- Helper: Check if user is a builder member for a given society
CREATE OR REPLACE FUNCTION public.is_builder_for_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.builder_members bm
    JOIN public.builder_societies bs ON bs.builder_id = bm.builder_id
    WHERE bm.user_id = _user_id
      AND bs.society_id = _society_id
      AND bm.deactivated_at IS NULL
  )
$$;

-- Helper: Check if user can write to a society (own society OR builder/admin for it)
CREATE OR REPLACE FUNCTION public.can_write_to_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    get_user_society_id(_user_id) = _society_id
    OR is_admin(_user_id)
    OR is_society_admin(_user_id, _society_id)
    OR is_builder_for_society(_user_id, _society_id)
  )
$$;

-- Fix visitor_entries INSERT policy
DROP POLICY IF EXISTS "Residents can create visitor entries" ON public.visitor_entries;
CREATE POLICY "Members can create visitor entries"
  ON public.visitor_entries FOR INSERT
  WITH CHECK (
    resident_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix parcel_entries INSERT policy
DROP POLICY IF EXISTS "Admins and guards can log parcels" ON public.parcel_entries;
CREATE POLICY "Members can log parcels"
  ON public.parcel_entries FOR INSERT
  WITH CHECK (
    resident_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix domestic_help_entries INSERT
DROP POLICY IF EXISTS "Residents can add their own domestic help" ON public.domestic_help_entries;
CREATE POLICY "Members can add domestic help"
  ON public.domestic_help_entries FOR INSERT
  WITH CHECK (
    resident_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix domestic_help_attendance INSERT
DROP POLICY IF EXISTS "Members can mark attendance" ON public.domestic_help_attendance;
CREATE POLICY "Members can mark attendance"
  ON public.domestic_help_attendance FOR INSERT
  WITH CHECK (
    marked_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix dispute_tickets INSERT
DROP POLICY IF EXISTS "Users can create tickets in their society" ON public.dispute_tickets;
CREATE POLICY "Members can create dispute tickets"
  ON public.dispute_tickets FOR INSERT
  WITH CHECK (
    submitted_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix snag_tickets INSERT
DROP POLICY IF EXISTS "Society members can create snag tickets" ON public.snag_tickets;
CREATE POLICY "Members can create snag tickets"
  ON public.snag_tickets FOR INSERT
  WITH CHECK (
    reported_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix inspection_checklists INSERT
DROP POLICY IF EXISTS "Residents can create checklists" ON public.inspection_checklists;
CREATE POLICY "Members can create checklists"
  ON public.inspection_checklists FOR INSERT
  WITH CHECK (
    resident_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix help_requests INSERT
DROP POLICY IF EXISTS "Users can create help requests in their society" ON public.help_requests;
CREATE POLICY "Members can create help requests"
  ON public.help_requests FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix bulletin_posts INSERT
DROP POLICY IF EXISTS "Users can create posts in their society" ON public.bulletin_posts;
CREATE POLICY "Members can create posts in their society"
  ON public.bulletin_posts FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix society_expenses INSERT
DROP POLICY IF EXISTS "Admins and society admins can insert expenses" ON public.society_expenses;
CREATE POLICY "Admins can insert expenses"
  ON public.society_expenses FOR INSERT
  WITH CHECK (
    added_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix society_income INSERT
DROP POLICY IF EXISTS "Admins and society admins can insert income" ON public.society_income;
CREATE POLICY "Admins can insert income"
  ON public.society_income FOR INSERT
  WITH CHECK (
    added_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix construction_milestones INSERT
DROP POLICY IF EXISTS "Admins can create milestones" ON public.construction_milestones;
CREATE POLICY "Admins can create milestones"
  ON public.construction_milestones FOR INSERT
  WITH CHECK (
    posted_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix emergency_broadcasts INSERT
DROP POLICY IF EXISTS "Admins can create broadcasts" ON public.emergency_broadcasts;
CREATE POLICY "Admins can create broadcasts"
  ON public.emergency_broadcasts FOR INSERT
  WITH CHECK (
    sent_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix worker_job_requests INSERT
DROP POLICY IF EXISTS "Resident can create job requests" ON public.worker_job_requests;
CREATE POLICY "Members can create job requests"
  ON public.worker_job_requests FOR INSERT
  WITH CHECK (
    resident_id = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix parking_violations INSERT
DROP POLICY IF EXISTS "Members can report violations" ON public.parking_violations;
CREATE POLICY "Members can report violations"
  ON public.parking_violations FOR INSERT
  WITH CHECK (
    reported_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix project_questions INSERT
DROP POLICY IF EXISTS "Society members can ask questions" ON public.project_questions;
CREATE POLICY "Members can ask questions"
  ON public.project_questions FOR INSERT
  WITH CHECK (
    asked_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
  );

-- Fix project_documents INSERT
DROP POLICY IF EXISTS "Admins can insert documents" ON public.project_documents;
CREATE POLICY "Admins can insert documents"
  ON public.project_documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix payment_milestones INSERT
DROP POLICY IF EXISTS "Admins can manage payment milestones" ON public.payment_milestones;
CREATE POLICY "Admins can manage payment milestones"
  ON public.payment_milestones FOR INSERT
  WITH CHECK (
    can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );

-- Fix maintenance_dues INSERT
DROP POLICY IF EXISTS "Admins can insert dues" ON public.maintenance_dues;
CREATE POLICY "Admins can insert dues"
  ON public.maintenance_dues FOR INSERT
  WITH CHECK (
    can_write_to_society(auth.uid(), society_id)
    AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))
  );
