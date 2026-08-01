
-- Fix E: Feature-gated RLS write policies for tables that exist

-- gate_entries: gate_entry
CREATE POLICY "gate_entries_feature_gate_insert" ON public.gate_entries
  FOR INSERT WITH CHECK (public.can_access_feature('gate_entry'));
CREATE POLICY "gate_entries_feature_gate_update" ON public.gate_entries
  FOR UPDATE USING (public.can_access_feature('gate_entry'));
CREATE POLICY "gate_entries_feature_gate_delete" ON public.gate_entries
  FOR DELETE USING (public.can_access_feature('gate_entry'));

-- manual_entry_requests: gate_entry
CREATE POLICY "manual_entry_feature_gate_insert" ON public.manual_entry_requests
  FOR INSERT WITH CHECK (public.can_access_feature('gate_entry'));
CREATE POLICY "manual_entry_feature_gate_update" ON public.manual_entry_requests
  FOR UPDATE USING (public.can_access_feature('gate_entry'));
CREATE POLICY "manual_entry_feature_gate_delete" ON public.manual_entry_requests
  FOR DELETE USING (public.can_access_feature('gate_entry'));

-- worker_attendance: worker_attendance
CREATE POLICY "worker_attendance_feature_gate_insert" ON public.worker_attendance
  FOR INSERT WITH CHECK (public.can_access_feature('worker_attendance'));
CREATE POLICY "worker_attendance_feature_gate_update" ON public.worker_attendance
  FOR UPDATE USING (public.can_access_feature('worker_attendance'));
CREATE POLICY "worker_attendance_feature_gate_delete" ON public.worker_attendance
  FOR DELETE USING (public.can_access_feature('worker_attendance'));

-- worker_leave_records: worker_leave
CREATE POLICY "worker_leave_feature_gate_insert" ON public.worker_leave_records
  FOR INSERT WITH CHECK (public.can_access_feature('worker_leave'));
CREATE POLICY "worker_leave_feature_gate_update" ON public.worker_leave_records
  FOR UPDATE USING (public.can_access_feature('worker_leave'));
CREATE POLICY "worker_leave_feature_gate_delete" ON public.worker_leave_records
  FOR DELETE USING (public.can_access_feature('worker_leave'));

-- worker_salary_records: worker_salary
CREATE POLICY "worker_salary_feature_gate_insert" ON public.worker_salary_records
  FOR INSERT WITH CHECK (public.can_access_feature('worker_salary'));
CREATE POLICY "worker_salary_feature_gate_update" ON public.worker_salary_records
  FOR UPDATE USING (public.can_access_feature('worker_salary'));
CREATE POLICY "worker_salary_feature_gate_delete" ON public.worker_salary_records
  FOR DELETE USING (public.can_access_feature('worker_salary'));

-- worker_ratings: workforce_management
CREATE POLICY "worker_ratings_feature_gate_insert" ON public.worker_ratings
  FOR INSERT WITH CHECK (public.can_access_feature('workforce_management'));
CREATE POLICY "worker_ratings_feature_gate_update" ON public.worker_ratings
  FOR UPDATE USING (public.can_access_feature('workforce_management'));
CREATE POLICY "worker_ratings_feature_gate_delete" ON public.worker_ratings
  FOR DELETE USING (public.can_access_feature('workforce_management'));

-- society_notices: society_notices
CREATE POLICY "society_notices_feature_gate_insert" ON public.society_notices
  FOR INSERT WITH CHECK (public.can_access_feature('society_notices'));
CREATE POLICY "society_notices_feature_gate_update" ON public.society_notices
  FOR UPDATE USING (public.can_access_feature('society_notices'));
CREATE POLICY "society_notices_feature_gate_delete" ON public.society_notices
  FOR DELETE USING (public.can_access_feature('society_notices'));

-- delivery_assignments: delivery_management
CREATE POLICY "delivery_assign_feature_gate_insert" ON public.delivery_assignments
  FOR INSERT WITH CHECK (public.can_access_feature('delivery_management'));
CREATE POLICY "delivery_assign_feature_gate_update" ON public.delivery_assignments
  FOR UPDATE USING (public.can_access_feature('delivery_management'));
CREATE POLICY "delivery_assign_feature_gate_delete" ON public.delivery_assignments
  FOR DELETE USING (public.can_access_feature('delivery_management'));

-- inspection_items: inspection
CREATE POLICY "inspection_feature_gate_insert" ON public.inspection_items
  FOR INSERT WITH CHECK (public.can_access_feature('inspection'));
CREATE POLICY "inspection_feature_gate_update" ON public.inspection_items
  FOR UPDATE USING (public.can_access_feature('inspection'));
CREATE POLICY "inspection_feature_gate_delete" ON public.inspection_items
  FOR DELETE USING (public.can_access_feature('inspection'));

-- payment_milestones: payment_milestones
CREATE POLICY "payment_ms_feature_gate_insert" ON public.payment_milestones
  FOR INSERT WITH CHECK (public.can_access_feature('payment_milestones'));
CREATE POLICY "payment_ms_feature_gate_update" ON public.payment_milestones
  FOR UPDATE USING (public.can_access_feature('payment_milestones'));
CREATE POLICY "payment_ms_feature_gate_delete" ON public.payment_milestones
  FOR DELETE USING (public.can_access_feature('payment_milestones'));
