
-- BATCH 1: Config tables
CREATE POLICY "auth_read_attribute_blocks" ON public.attribute_block_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_badge_config" ON public.badge_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_feature_packages" ON public.feature_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_feature_package_items" ON public.feature_package_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_platform_features" ON public.platform_features FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_order_status_config" ON public.order_status_config FOR SELECT TO authenticated USING (true);

-- BATCH 2: User-owned
CREATE POLICY "own_read_notif_queue" ON public.notification_queue FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_read_notif_prefs" ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_insert_notif_prefs" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_update_notif_prefs" ON public.notification_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_read_push_logs" ON public.push_logs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "auth_insert_mkt_events" ON public.marketplace_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "own_read_mkt_events" ON public.marketplace_events FOR SELECT TO authenticated USING (actor_id = auth.uid());
CREATE POLICY "auth_insert_search_demand" ON public.search_demand_log FOR INSERT TO authenticated WITH CHECK (true);

-- BATCH 3: Society-scoped
CREATE POLICY "own_read_auth_persons" ON public.authorized_persons FOR SELECT TO authenticated USING (resident_id = auth.uid());
CREATE POLICY "own_insert_auth_persons" ON public.authorized_persons FOR INSERT TO authenticated WITH CHECK (resident_id = auth.uid());
CREATE POLICY "own_update_auth_persons" ON public.authorized_persons FOR UPDATE TO authenticated USING (resident_id = auth.uid());
CREATE POLICY "soc_read_gate" ON public.gate_entries FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_gate" ON public.gate_entries FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_parcels" ON public.parcel_entries FOR SELECT TO authenticated USING (resident_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_parcels" ON public.parcel_entries FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_parcels" ON public.parcel_entries FOR UPDATE TO authenticated USING (resident_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_parking" ON public.parking_slots FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_parking" ON public.parking_slots FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_violations" ON public.parking_violations FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_violations" ON public.parking_violations FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_manual_entry" ON public.manual_entry_requests FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_manual_entry" ON public.manual_entry_requests FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_manual_entry" ON public.manual_entry_requests FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_dh_entries" ON public.domestic_help_entries FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_dh_entries" ON public.domestic_help_entries FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_dh_entries" ON public.domestic_help_entries FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_dh_attend" ON public.domestic_help_attendance FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_dh_attend" ON public.domestic_help_attendance FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_dh_attend" ON public.domestic_help_attendance FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_workers" ON public.society_workers FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_workers" ON public.society_workers FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_workers" ON public.society_workers FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_worker_cats" ON public.society_worker_categories FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_worker_cats" ON public.society_worker_categories FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_job_reqs" ON public.worker_job_requests FOR SELECT TO authenticated USING (resident_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_insert_job_reqs" ON public.worker_job_requests FOR INSERT TO authenticated WITH CHECK (resident_id = auth.uid());
CREATE POLICY "soc_update_job_reqs" ON public.worker_job_requests FOR UPDATE TO authenticated USING (resident_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_leave" ON public.worker_leave_records FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_leave" ON public.worker_leave_records FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_leave" ON public.worker_leave_records FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_read_worker_ratings" ON public.worker_ratings FOR SELECT TO authenticated USING (resident_id = auth.uid());
CREATE POLICY "own_insert_worker_ratings" ON public.worker_ratings FOR INSERT TO authenticated WITH CHECK (resident_id = auth.uid());
CREATE POLICY "soc_read_salary" ON public.worker_salary_records FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_salary" ON public.worker_salary_records FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_salary" ON public.worker_salary_records FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_inspections" ON public.inspection_checklists FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_insert_inspections" ON public.inspection_checklists FOR INSERT TO authenticated WITH CHECK (resident_id = auth.uid());
CREATE POLICY "soc_update_inspections" ON public.inspection_checklists FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_insp_items" ON public.inspection_items FOR SELECT TO authenticated USING (checklist_id IN (SELECT id FROM public.inspection_checklists WHERE society_id = public.get_user_society_id(auth.uid())));
CREATE POLICY "own_insert_insp_items" ON public.inspection_items FOR INSERT TO authenticated WITH CHECK (checklist_id IN (SELECT id FROM public.inspection_checklists WHERE resident_id = auth.uid()));
CREATE POLICY "soc_update_insp_items" ON public.inspection_items FOR UPDATE TO authenticated USING (checklist_id IN (SELECT id FROM public.inspection_checklists WHERE society_id = public.get_user_society_id(auth.uid())));
CREATE POLICY "soc_read_coll_buy" ON public.collective_buy_requests FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_insert_coll_buy" ON public.collective_buy_requests FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "own_update_coll_buy" ON public.collective_buy_requests FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "soc_read_coll_parts" ON public.collective_buy_participants FOR SELECT TO authenticated USING (request_id IN (SELECT id FROM public.collective_buy_requests WHERE society_id = public.get_user_society_id(auth.uid())));
CREATE POLICY "own_insert_coll_parts" ON public.collective_buy_participants FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "soc_read_escalations" ON public.collective_escalations FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_campaigns" ON public.campaigns FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_insert_campaigns" ON public.campaigns FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "own_update_campaigns" ON public.campaigns FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "soc_read_budgets" ON public.society_budgets FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_budgets" ON public.society_budgets FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_budgets" ON public.society_budgets FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_res_payments" ON public.resident_payments FOR SELECT TO authenticated USING (resident_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "own_insert_res_payments" ON public.resident_payments FOR INSERT TO authenticated WITH CHECK (resident_id = auth.uid());
CREATE POLICY "soc_read_security" ON public.security_staff FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_security" ON public.security_staff FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_security" ON public.security_staff FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_feat_overrides" ON public.society_feature_overrides FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_feat_overrides" ON public.society_feature_overrides FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_feat_overrides" ON public.society_feature_overrides FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_pay_milestones" ON public.payment_milestones FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));

-- BATCH 4: Builder
CREATE POLICY "builder_read_announcements" ON public.builder_announcements FOR SELECT TO authenticated USING (public.is_builder_member(auth.uid(), builder_id) OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "builder_insert_announcements" ON public.builder_announcements FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "builder_read_feat_pkgs" ON public.builder_feature_packages FOR SELECT TO authenticated USING (public.is_builder_member(auth.uid(), builder_id));

-- BATCH 7 partial: Audit (no seller refs)
CREATE POLICY "audit_read_own" ON public.audit_log FOR SELECT TO authenticated USING (actor_id = auth.uid() OR society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "admin_read_ai_review" ON public.ai_review_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
