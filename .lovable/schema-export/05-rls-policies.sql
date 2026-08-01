[map[policy_ddl:-- Policy: Only admins can manage settings on admin_settings (ALL)
CREATE POLICY "Only admins can manage settings" ON public.admin_settings
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Platform admins can view AI review logs on ai_review_log (SELECT)
CREATE POLICY "Platform admins can view AI review logs" ON public.ai_review_log
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::user_role)))))
;
-- Policy: Admins can delete attribute blocks on attribute_block_library (DELETE)
CREATE POLICY "Admins can delete attribute blocks" ON public.attribute_block_library
  FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: Admins can insert attribute blocks on attribute_block_library (INSERT)
CREATE POLICY "Admins can insert attribute blocks" ON public.attribute_block_library
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Admins can update attribute blocks on attribute_block_library (UPDATE)
CREATE POLICY "Admins can update attribute blocks" ON public.attribute_block_library
  FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: authenticated_read on attribute_block_library (SELECT)
CREATE POLICY "authenticated_read" ON public.attribute_block_library
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Admins can view audit logs on audit_log (SELECT)
CREATE POLICY "Admins can view audit logs" ON public.audit_log
  FOR SELECT
  TO public
  USING ((is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Authenticated users can insert audit logs on audit_log (INSERT)
CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_log
  FOR INSERT
  TO public
  WITH CHECK ((actor_id = auth.uid()))
;
-- Policy: Only admins can view archived audit logs on audit_log_archive (SELECT)
CREATE POLICY "Only admins can view archived audit logs" ON public.audit_log_archive
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: Residents can delete their own authorized persons on authorized_persons (DELETE)
CREATE POLICY "Residents can delete their own authorized persons" ON public.authorized_persons
  FOR DELETE
  TO public
  USING ((resident_id = auth.uid()))
;
-- Policy: Residents can insert authorized persons on authorized_persons (INSERT)
CREATE POLICY "Residents can insert authorized persons" ON public.authorized_persons
  FOR INSERT
  TO public
  WITH CHECK (((resident_id = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Residents can update their own authorized persons on authorized_persons (UPDATE)
CREATE POLICY "Residents can update their own authorized persons" ON public.authorized_persons
  FOR UPDATE
  TO public
  USING ((resident_id = auth.uid()))
;
-- Policy: Residents can view their own authorized persons on authorized_persons (SELECT)
CREATE POLICY "Residents can view their own authorized persons" ON public.authorized_persons
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_security_officer(auth.uid(), society_id)))
;
-- Policy: Badge config is readable by everyone on badge_config (SELECT)
CREATE POLICY "Badge config is readable by everyone" ON public.badge_config
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Only admins can modify badge config on badge_config (ALL)
CREATE POLICY "Only admins can modify badge config" ON public.badge_config
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Builder members can create announcements on builder_announcements (INSERT)
CREATE POLICY "Builder members can create announcements" ON public.builder_announcements
  FOR INSERT
  TO public
  WITH CHECK (is_builder_for_society(auth.uid(), society_id))
;
-- Policy: Society members can read announcements on builder_announcements (SELECT)
CREATE POLICY "Society members can read announcements" ON public.builder_announcements
  FOR SELECT
  TO public
  USING (((society_id IN ( SELECT p.society_id
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.society_id IS NOT NULL)))) OR is_builder_for_society(auth.uid(), society_id) OR (EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::user_role))))))
;
-- Policy: Admins can manage builder packages on builder_feature_packages (ALL)
CREATE POLICY "Admins can manage builder packages" ON public.builder_feature_packages
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Builder members can view own packages on builder_feature_packages (SELECT)
CREATE POLICY "Builder members can view own packages" ON public.builder_feature_packages
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM builder_members bm
  WHERE ((bm.builder_id = builder_feature_packages.builder_id) AND (bm.user_id = auth.uid()) AND (bm.deactivated_at IS NULL)))))
;
-- Policy: Admins can manage builder members on builder_members (ALL)
CREATE POLICY "Admins can manage builder members" ON public.builder_members
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Builder members can view their builder on builder_members (SELECT)
CREATE POLICY "Builder members can view their builder" ON public.builder_members
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Builder societies visible to builder members on builder_societies (SELECT)
CREATE POLICY "Builder societies visible to builder members" ON public.builder_societies
  FOR SELECT
  TO public
  USING ((is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM builder_members bm
  WHERE ((bm.builder_id = builder_societies.builder_id) AND (bm.user_id = auth.uid()))))))
;
-- Policy: Only platform admins can manage builder societies on builder_societies (ALL)
CREATE POLICY "Only platform admins can manage builder societies" ON public.builder_societies
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Admins can manage builders on builders (ALL)
CREATE POLICY "Admins can manage builders" ON public.builders
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Anyone can view active builders on builders (SELECT)
CREATE POLICY "Anyone can view active builders" ON public.builders
  FOR SELECT
  TO authenticated
  USING (((is_active = true) OR is_admin(auth.uid())))
;
-- Policy: Authors can delete comments on bulletin_comments (DELETE)
CREATE POLICY "Authors can delete comments" ON public.bulletin_comments
  FOR DELETE
  TO public
  USING (((author_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can create comments on bulletin_comments (INSERT)
CREATE POLICY "Users can create comments" ON public.bulletin_comments
  FOR INSERT
  TO public
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_comments.post_id) AND (bp.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Users can view comments in their society on bulletin_comments (SELECT)
CREATE POLICY "Users can view comments in their society" ON public.bulletin_comments
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_comments.post_id) AND ((bp.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Authors and admins can delete posts on bulletin_posts (DELETE)
CREATE POLICY "Authors and admins can delete posts" ON public.bulletin_posts
  FOR DELETE
  TO public
  USING (((author_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Authors can update their own posts on bulletin_posts (UPDATE)
CREATE POLICY "Authors can update their own posts" ON public.bulletin_posts
  FOR UPDATE
  TO public
  USING (((author_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can create posts in their society on bulletin_posts (INSERT)
CREATE POLICY "Users can create posts in their society" ON public.bulletin_posts
  FOR INSERT
  TO public
  WITH CHECK (((author_id = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Users can view posts in their society on bulletin_posts (SELECT)
CREATE POLICY "Users can view posts in their society" ON public.bulletin_posts
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Users can RSVP on bulletin_rsvps (INSERT)
CREATE POLICY "Users can RSVP" ON public.bulletin_rsvps
  FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_rsvps.post_id) AND (bp.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Users can delete RSVP on bulletin_rsvps (DELETE)
CREATE POLICY "Users can delete RSVP" ON public.bulletin_rsvps
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can update RSVP on bulletin_rsvps (UPDATE)
CREATE POLICY "Users can update RSVP" ON public.bulletin_rsvps
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view RSVPs on bulletin_rsvps (SELECT)
CREATE POLICY "Users can view RSVPs" ON public.bulletin_rsvps
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_rsvps.post_id) AND ((bp.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Users can remove votes on bulletin_votes (DELETE)
CREATE POLICY "Users can remove votes" ON public.bulletin_votes
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view votes on bulletin_votes (SELECT)
CREATE POLICY "Users can view votes" ON public.bulletin_votes
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_votes.post_id) AND ((bp.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Users can vote on bulletin_votes (INSERT)
CREATE POLICY "Users can vote" ON public.bulletin_votes
  FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM bulletin_posts bp
  WHERE ((bp.id = bulletin_votes.post_id) AND (bp.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Buyers can insert their own feedback on call_feedback (INSERT)
CREATE POLICY "Buyers can insert their own feedback" ON public.call_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Users can read their own feedback on call_feedback (SELECT)
CREATE POLICY "Users can read their own feedback" ON public.call_feedback
  FOR SELECT
  TO authenticated
  USING (((buyer_id = auth.uid()) OR (seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Only admins can manage campaigns on campaigns (ALL)
CREATE POLICY "Only admins can manage campaigns" ON public.campaigns
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Users can delete from their own cart on cart_items (DELETE)
CREATE POLICY "Users can delete from their own cart" ON public.cart_items
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can manage their own cart on cart_items (INSERT)
CREATE POLICY "Users can manage their own cart" ON public.cart_items
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can update their own cart on cart_items (UPDATE)
CREATE POLICY "Users can update their own cart" ON public.cart_items
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view their own cart on cart_items (SELECT)
CREATE POLICY "Users can view their own cart" ON public.cart_items
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Anyone can view active categories on category_config (SELECT)
CREATE POLICY "Anyone can view active categories" ON public.category_config
  FOR SELECT
  TO public
  USING (((is_active = true) OR is_admin(auth.uid())))
;
-- Policy: Only admins can manage categories on category_config (ALL)
CREATE POLICY "Only admins can manage categories" ON public.category_config
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: authenticated_read on category_status_flows (SELECT)
CREATE POLICY "authenticated_read" ON public.category_status_flows
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Users can mark messages as read on chat_messages (UPDATE)
CREATE POLICY "Users can mark messages as read" ON public.chat_messages
  FOR UPDATE
  TO public
  USING ((receiver_id = auth.uid()))
;
-- Policy: Users can send chat messages on chat_messages (INSERT)
CREATE POLICY "Users can send chat messages" ON public.chat_messages
  FOR INSERT
  TO public
  WITH CHECK ((sender_id = auth.uid()))
;
-- Policy: Users can view their own chat messages on chat_messages (SELECT)
CREATE POLICY "Users can view their own chat messages" ON public.chat_messages
  FOR SELECT
  TO public
  USING (((sender_id = auth.uid()) OR (receiver_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Society members can view participants on collective_buy_participants (SELECT)
CREATE POLICY "Society members can view participants" ON public.collective_buy_participants
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM collective_buy_requests r
  WHERE ((r.id = collective_buy_participants.request_id) AND (r.society_id = get_user_society_id(auth.uid()))))))
;
-- Policy: Users can join collective buys on collective_buy_participants (INSERT)
CREATE POLICY "Users can join collective buys" ON public.collective_buy_participants
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can leave collective buys on collective_buy_participants (DELETE)
CREATE POLICY "Users can leave collective buys" ON public.collective_buy_participants
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Authors can update collective buy requests on collective_buy_requests (UPDATE)
CREATE POLICY "Authors can update collective buy requests" ON public.collective_buy_requests
  FOR UPDATE
  TO public
  USING (((created_by = auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Society members can create collective buy requests on collective_buy_requests (INSERT)
CREATE POLICY "Society members can create collective buy requests" ON public.collective_buy_requests
  FOR INSERT
  TO public
  WITH CHECK (((created_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Society members can view collective buy requests on collective_buy_requests (SELECT)
CREATE POLICY "Society members can view collective buy requests" ON public.collective_buy_requests
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can update escalations on collective_escalations (UPDATE)
CREATE POLICY "Admins can update escalations" ON public.collective_escalations
  FOR UPDATE
  TO public
  USING ((is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Service role inserts escalations on collective_escalations (INSERT)
CREATE POLICY "Service role inserts escalations" ON public.collective_escalations
  FOR INSERT
  TO public
  WITH CHECK (true)
;
-- Policy: Society members can view escalations on collective_escalations (SELECT)
CREATE POLICY "Society members can view escalations" ON public.collective_escalations
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can create milestones on construction_milestones (INSERT)
CREATE POLICY "Admins can create milestones" ON public.construction_milestones
  FOR INSERT
  TO public
  WITH CHECK (((posted_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can delete milestones on construction_milestones (DELETE)
CREATE POLICY "Admins can delete milestones" ON public.construction_milestones
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can update milestones on construction_milestones (UPDATE)
CREATE POLICY "Admins can update milestones" ON public.construction_milestones
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Society members can view milestones on construction_milestones (SELECT)
CREATE POLICY "Society members can view milestones" ON public.construction_milestones
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Users can create redemptions on coupon_redemptions (INSERT)
CREATE POLICY "Users can create redemptions" ON public.coupon_redemptions
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can view their own redemptions on coupon_redemptions (SELECT)
CREATE POLICY "Users can view their own redemptions" ON public.coupon_redemptions
  FOR SELECT
  TO public
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Admins can manage all coupons on coupons (ALL)
CREATE POLICY "Admins can manage all coupons" ON public.coupons
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Buyers can view active coupons on coupons (SELECT)
CREATE POLICY "Buyers can view active coupons" ON public.coupons
  FOR SELECT
  TO authenticated
  USING (((is_active = true) AND ((expires_at IS NULL) OR (expires_at > now())) AND (starts_at <= now())))
;
-- Policy: Sellers can manage their own coupons on coupons (ALL)
CREATE POLICY "Sellers can manage their own coupons" ON public.coupons
  FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles
  WHERE ((seller_profiles.id = coupons.seller_id) AND (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Users manage own addresses on delivery_addresses (ALL)
CREATE POLICY "Users manage own addresses" ON public.delivery_addresses
  FOR ALL
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Relevant users can view delivery assignments on delivery_assignments (SELECT)
CREATE POLICY "Relevant users can view delivery assignments" ON public.delivery_assignments
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = delivery_assignments.order_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM seller_profiles sp
          WHERE ((sp.id = o.seller_id) AND (sp.user_id = auth.uid())))))))) OR is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: delivery_locations_select on delivery_locations (SELECT)
CREATE POLICY "delivery_locations_select" ON public.delivery_locations
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (delivery_assignments da
     JOIN orders o ON ((o.id = da.order_id)))
  WHERE ((da.id = delivery_locations.assignment_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM seller_profiles sp
          WHERE ((sp.id = o.seller_id) AND (sp.user_id = auth.uid())))))))))
;
-- Policy: Society admins can manage delivery pool on delivery_partner_pool (ALL)
CREATE POLICY "Society admins can manage delivery pool" ON public.delivery_partner_pool
  FOR ALL
  TO public
  USING ((is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Society members can view delivery pool on delivery_partner_pool (SELECT)
CREATE POLICY "Society members can view delivery pool" ON public.delivery_partner_pool
  FOR SELECT
  TO public
  USING ((society_id = get_user_society_id(auth.uid())))
;
-- Policy: Admins can manage delivery partners on delivery_partners (INSERT)
CREATE POLICY "Admins can manage delivery partners" ON public.delivery_partners
  FOR INSERT
  TO public
  WITH CHECK ((is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Admins can update delivery partners on delivery_partners (UPDATE)
CREATE POLICY "Admins can update delivery partners" ON public.delivery_partners
  FOR UPDATE
  TO public
  USING ((is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Society members can view delivery partners on delivery_partners (SELECT)
CREATE POLICY "Society members can view delivery partners" ON public.delivery_partners
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Relevant users can view tracking logs on delivery_tracking_logs (SELECT)
CREATE POLICY "Relevant users can view tracking logs" ON public.delivery_tracking_logs
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM (delivery_assignments da
     JOIN orders o ON ((o.id = da.order_id)))
  WHERE ((da.id = delivery_tracking_logs.assignment_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM seller_profiles sp
          WHERE ((sp.id = o.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid()) OR is_society_admin(auth.uid(), da.society_id))))))
;
-- Policy: Users can delete their own tokens on device_tokens (DELETE)
CREATE POLICY "Users can delete their own tokens" ON public.device_tokens
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id))
;
-- Policy: Users can insert their own tokens on device_tokens (INSERT)
CREATE POLICY "Users can insert their own tokens" ON public.device_tokens
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id))
;
-- Policy: Users can update their own tokens on device_tokens (UPDATE)
CREATE POLICY "Users can update their own tokens" ON public.device_tokens
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
;
-- Policy: Users can view their own tokens on device_tokens (SELECT)
CREATE POLICY "Users can view their own tokens" ON public.device_tokens
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id))
;
-- Policy: Users can add comments on dispute_comments (INSERT)
CREATE POLICY "Users can add comments" ON public.dispute_comments
  FOR INSERT
  TO public
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM dispute_tickets dt
  WHERE ((dt.id = dispute_comments.ticket_id) AND ((dt.submitted_by = auth.uid()) OR ((dt.society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), dt.society_id)))))))))
;
-- Policy: Users can view comments on dispute_comments (SELECT)
CREATE POLICY "Users can view comments" ON public.dispute_comments
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM dispute_tickets dt
  WHERE ((dt.id = dispute_comments.ticket_id) AND ((dt.submitted_by = auth.uid()) OR ((dt.society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), dt.society_id))))))))
;
-- Policy: Admins can update tickets on dispute_tickets (UPDATE)
CREATE POLICY "Admins can update tickets" ON public.dispute_tickets
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Users can create tickets on dispute_tickets (INSERT)
CREATE POLICY "Users can create tickets" ON public.dispute_tickets
  FOR INSERT
  TO public
  WITH CHECK (((submitted_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Users can view own tickets on dispute_tickets (SELECT)
CREATE POLICY "Users can view own tickets" ON public.dispute_tickets
  FOR SELECT
  TO public
  USING (((submitted_by = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Members can mark attendance on domestic_help_attendance (INSERT)
CREATE POLICY "Members can mark attendance" ON public.domestic_help_attendance
  FOR INSERT
  TO public
  WITH CHECK (((marked_by = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Members can update attendance on domestic_help_attendance (UPDATE)
CREATE POLICY "Members can update attendance" ON public.domestic_help_attendance
  FOR UPDATE
  TO public
  USING (((marked_by = auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Society members can view attendance on domestic_help_attendance (SELECT)
CREATE POLICY "Society members can view attendance" ON public.domestic_help_attendance
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Members can add domestic help on domestic_help_entries (INSERT)
CREATE POLICY "Members can add domestic help" ON public.domestic_help_entries
  FOR INSERT
  TO public
  WITH CHECK (((resident_id = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Residents can delete domestic help on domestic_help_entries (DELETE)
CREATE POLICY "Residents can delete domestic help" ON public.domestic_help_entries
  FOR DELETE
  TO public
  USING (((resident_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Residents can update domestic help on domestic_help_entries (UPDATE)
CREATE POLICY "Residents can update domestic help" ON public.domestic_help_entries
  FOR UPDATE
  TO public
  USING (((resident_id = auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Residents can view domestic help on domestic_help_entries (SELECT)
CREATE POLICY "Residents can view domestic help" ON public.domestic_help_entries
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can create broadcasts on emergency_broadcasts (INSERT)
CREATE POLICY "Admins can create broadcasts" ON public.emergency_broadcasts
  FOR INSERT
  TO public
  WITH CHECK (((society_id = get_user_society_id(auth.uid())) AND (sent_by = auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can delete broadcasts on emergency_broadcasts (DELETE)
CREATE POLICY "Admins can delete broadcasts" ON public.emergency_broadcasts
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Society members can view broadcasts on emergency_broadcasts (SELECT)
CREATE POLICY "Society members can view broadcasts" ON public.emergency_broadcasts
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can update flags on expense_flags (UPDATE)
CREATE POLICY "Admins can update flags" ON public.expense_flags
  FOR UPDATE
  TO public
  USING ((is_admin(auth.uid()) OR is_society_admin(auth.uid(), ( SELECT se.society_id
   FROM society_expenses se
  WHERE (se.id = expense_flags.expense_id)))))
;
-- Policy: Flaggers and admins can view flags on expense_flags (SELECT)
CREATE POLICY "Flaggers and admins can view flags" ON public.expense_flags
  FOR SELECT
  TO public
  USING (((flagged_by = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Society members can flag expenses on expense_flags (INSERT)
CREATE POLICY "Society members can flag expenses" ON public.expense_flags
  FOR INSERT
  TO public
  WITH CHECK (((flagged_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM society_expenses se
  WHERE ((se.id = expense_flags.expense_id) AND (se.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Users can record views on expense_views (INSERT)
CREATE POLICY "Users can record views" ON public.expense_views
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can view expense views on expense_views (SELECT)
CREATE POLICY "Users can view expense views" ON public.expense_views
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM society_expenses se
  WHERE ((se.id = expense_views.expense_id) AND (se.society_id = get_user_society_id(auth.uid()))))))
;
-- Policy: Users can add favorites on favorites (INSERT)
CREATE POLICY "Users can add favorites" ON public.favorites
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can remove favorites on favorites (DELETE)
CREATE POLICY "Users can remove favorites" ON public.favorites
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view their own favorites on favorites (SELECT)
CREATE POLICY "Users can view their own favorites" ON public.favorites
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Admins can manage package items on feature_package_items (ALL)
CREATE POLICY "Admins can manage package items" ON public.feature_package_items
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Authenticated users can view package items on feature_package_items (SELECT)
CREATE POLICY "Authenticated users can view package items" ON public.feature_package_items
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Admins can manage packages on feature_packages (ALL)
CREATE POLICY "Admins can manage packages" ON public.feature_packages
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Authenticated users can view packages on feature_packages (SELECT)
CREATE POLICY "Authenticated users can view packages" ON public.feature_packages
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Anyone can view active featured items in their society on featured_items (SELECT)
CREATE POLICY "Anyone can view active featured items in their society" ON public.featured_items
  FOR SELECT
  TO authenticated
  USING ((((is_active = true) AND ((society_id IS NULL) OR (society_id = get_user_society_id(auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Only admins can manage featured items on featured_items (ALL)
CREATE POLICY "Only admins can manage featured items" ON public.featured_items
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Residents can view own entries on gate_entries (SELECT)
CREATE POLICY "Residents can view own entries" ON public.gate_entries
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()))
;
-- Policy: Security officers can insert gate entries on gate_entries (INSERT)
CREATE POLICY "Security officers can insert gate entries" ON public.gate_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (is_security_officer(auth.uid(), society_id))
;
-- Policy: Security officers can view society entries on gate_entries (SELECT)
CREATE POLICY "Security officers can view society entries" ON public.gate_entries
  FOR SELECT
  TO authenticated
  USING (is_security_officer(auth.uid(), society_id))
;
-- Policy: Society admins can view all entries on gate_entries (SELECT)
CREATE POLICY "Society admins can view all entries" ON public.gate_entries
  FOR SELECT
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Authors can delete help requests on help_requests (DELETE)
CREATE POLICY "Authors can delete help requests" ON public.help_requests
  FOR DELETE
  TO public
  USING (((author_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Authors can update help requests on help_requests (UPDATE)
CREATE POLICY "Authors can update help requests" ON public.help_requests
  FOR UPDATE
  TO public
  USING (((author_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can create help requests on help_requests (INSERT)
CREATE POLICY "Users can create help requests" ON public.help_requests
  FOR INSERT
  TO public
  WITH CHECK (((author_id = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Users can view help requests on help_requests (SELECT)
CREATE POLICY "Users can view help requests" ON public.help_requests
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Requester and responder can view responses on help_responses (SELECT)
CREATE POLICY "Requester and responder can view responses" ON public.help_responses
  FOR SELECT
  TO public
  USING (((responder_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM help_requests hr
  WHERE ((hr.id = help_responses.request_id) AND (hr.author_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Responders can delete responses on help_responses (DELETE)
CREATE POLICY "Responders can delete responses" ON public.help_responses
  FOR DELETE
  TO public
  USING ((responder_id = auth.uid()))
;
-- Policy: Users can respond to help requests on help_responses (INSERT)
CREATE POLICY "Users can respond to help requests" ON public.help_responses
  FOR INSERT
  TO public
  WITH CHECK (((responder_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM help_requests hr
  WHERE ((hr.id = help_responses.request_id) AND (hr.society_id = get_user_society_id(auth.uid())) AND (hr.status = 'open'::text))))))
;
-- Policy: Members can create checklists on inspection_checklists (INSERT)
CREATE POLICY "Members can create checklists" ON public.inspection_checklists
  FOR INSERT
  TO public
  WITH CHECK (((resident_id = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Residents can update own checklists on inspection_checklists (UPDATE)
CREATE POLICY "Residents can update own checklists" ON public.inspection_checklists
  FOR UPDATE
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Residents can view own checklists on inspection_checklists (SELECT)
CREATE POLICY "Residents can view own checklists" ON public.inspection_checklists
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid())))
;
-- Policy: Items visible with checklist access on inspection_items (SELECT)
CREATE POLICY "Items visible with checklist access" ON public.inspection_items
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM inspection_checklists ic
  WHERE ((ic.id = inspection_items.checklist_id) AND ((ic.resident_id = auth.uid()) OR ((ic.society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), ic.society_id))))))))
;
-- Policy: Owners can delete items on inspection_items (DELETE)
CREATE POLICY "Owners can delete items" ON public.inspection_items
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM inspection_checklists ic
  WHERE ((ic.id = inspection_items.checklist_id) AND (ic.resident_id = auth.uid())))))
;
-- Policy: Owners can manage items on inspection_items (INSERT)
CREATE POLICY "Owners can manage items" ON public.inspection_items
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM inspection_checklists ic
  WHERE ((ic.id = inspection_items.checklist_id) AND (ic.resident_id = auth.uid())))))
;
-- Policy: Owners can update items on inspection_items (UPDATE)
CREATE POLICY "Owners can update items" ON public.inspection_items
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM inspection_checklists ic
  WHERE ((ic.id = inspection_items.checklist_id) AND (ic.resident_id = auth.uid())))))
;
-- Policy: Admins can manage job_tts_cache on job_tts_cache (INSERT)
CREATE POLICY "Admins can manage job_tts_cache" ON public.job_tts_cache
  FOR INSERT
  TO public
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Authenticated can read job_tts_cache on job_tts_cache (SELECT)
CREATE POLICY "Authenticated can read job_tts_cache" ON public.job_tts_cache
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Admins can delete dues on maintenance_dues (DELETE)
CREATE POLICY "Admins can delete dues" ON public.maintenance_dues
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can insert dues on maintenance_dues (INSERT)
CREATE POLICY "Admins can insert dues" ON public.maintenance_dues
  FOR INSERT
  TO public
  WITH CHECK (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can update dues on maintenance_dues (UPDATE)
CREATE POLICY "Admins can update dues" ON public.maintenance_dues
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Residents can view own dues on maintenance_dues (SELECT)
CREATE POLICY "Residents can view own dues" ON public.maintenance_dues
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Residents can update their requests on manual_entry_requests (UPDATE)
CREATE POLICY "Residents can update their requests" ON public.manual_entry_requests
  FOR UPDATE
  TO authenticated
  USING ((resident_id = auth.uid()))
;
-- Policy: Residents can view requests for their flat on manual_entry_requests (SELECT)
CREATE POLICY "Residents can view requests for their flat" ON public.manual_entry_requests
  FOR SELECT
  TO authenticated
  USING ((resident_id = auth.uid()))
;
-- Policy: Security officers can create manual requests on manual_entry_requests (INSERT)
CREATE POLICY "Security officers can create manual requests" ON public.manual_entry_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (is_security_officer(auth.uid(), society_id))
;
-- Policy: Security officers can view requests on manual_entry_requests (SELECT)
CREATE POLICY "Security officers can view requests" ON public.manual_entry_requests
  FOR SELECT
  TO authenticated
  USING (is_security_officer(auth.uid(), society_id))
;
-- Policy: Admins can read all events on marketplace_events (SELECT)
CREATE POLICY "Admins can read all events" ON public.marketplace_events
  FOR SELECT
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Users can insert own events on marketplace_events (INSERT)
CREATE POLICY "Users can insert own events" ON public.marketplace_events
  FOR INSERT
  TO public
  WITH CHECK (((auth.uid() = user_id) OR (user_id IS NULL)))
;
-- Policy: Society members can add reactions on milestone_reactions (INSERT)
CREATE POLICY "Society members can add reactions" ON public.milestone_reactions
  FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM construction_milestones cm
  WHERE ((cm.id = milestone_reactions.milestone_id) AND (cm.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Society members can view reactions on milestone_reactions (SELECT)
CREATE POLICY "Society members can view reactions" ON public.milestone_reactions
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM construction_milestones cm
  WHERE ((cm.id = milestone_reactions.milestone_id) AND ((cm.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Users can remove reactions on milestone_reactions (DELETE)
CREATE POLICY "Users can remove reactions" ON public.milestone_reactions
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can insert own notification preferences on notification_preferences (INSERT)
CREATE POLICY "Users can insert own notification preferences" ON public.notification_preferences
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can update own notification preferences on notification_preferences (UPDATE)
CREATE POLICY "Users can update own notification preferences" ON public.notification_preferences
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view own notification preferences on notification_preferences (SELECT)
CREATE POLICY "Users can view own notification preferences" ON public.notification_preferences
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Authenticated users can enqueue notifications on notification_queue (INSERT)
CREATE POLICY "Authenticated users can enqueue notifications" ON public.notification_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (true)
;
-- Policy: Users can view own queued notifications on notification_queue (SELECT)
CREATE POLICY "Users can view own queued notifications" ON public.notification_queue
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can insert order items for their orders on order_items (INSERT)
CREATE POLICY "Users can insert order items for their orders" ON public.order_items
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.buyer_id = auth.uid())))))
;
-- Policy: Users can view order items for their orders on order_items (SELECT)
CREATE POLICY "Users can view order items for their orders" ON public.order_items
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM seller_profiles sp
          WHERE ((sp.id = o.seller_id) AND (sp.user_id = auth.uid())))))))) OR is_admin(auth.uid())))
;
-- Policy: authenticated_read on order_status_config (SELECT)
CREATE POLICY "authenticated_read" ON public.order_status_config
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Authenticated users can create orders on orders (INSERT)
CREATE POLICY "Authenticated users can create orders" ON public.orders
  FOR INSERT
  TO public
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Buyers and sellers can update orders on orders (UPDATE)
CREATE POLICY "Buyers and sellers can update orders" ON public.orders
  FOR UPDATE
  TO public
  USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = orders.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Users can view their own orders on orders (SELECT)
CREATE POLICY "Users can view their own orders" ON public.orders
  FOR SELECT
  TO public
  USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = orders.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Only admins can view archived orders on orders_archive (SELECT)
CREATE POLICY "Only admins can view archived orders" ON public.orders_archive
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: Admins can delete parcels on parcel_entries (DELETE)
CREATE POLICY "Admins can delete parcels" ON public.parcel_entries
  FOR DELETE
  TO public
  USING ((is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Admins can update parcels on parcel_entries (UPDATE)
CREATE POLICY "Admins can update parcels" ON public.parcel_entries
  FOR UPDATE
  TO public
  USING (((resident_id = auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Members can log parcels on parcel_entries (INSERT)
CREATE POLICY "Members can log parcels" ON public.parcel_entries
  FOR INSERT
  TO public
  WITH CHECK (((resident_id = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Residents can view their own parcels on parcel_entries (SELECT)
CREATE POLICY "Residents can view their own parcels" ON public.parcel_entries
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Anyone can view active parent groups on parent_groups (SELECT)
CREATE POLICY "Anyone can view active parent groups" ON public.parent_groups
  FOR SELECT
  TO public
  USING (((is_active = true) OR is_admin(auth.uid())))
;
-- Policy: Only admins can manage parent groups on parent_groups (ALL)
CREATE POLICY "Only admins can manage parent groups" ON public.parent_groups
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Admins can manage parking slots on parking_slots (ALL)
CREATE POLICY "Admins can manage parking slots" ON public.parking_slots
  FOR ALL
  TO public
  USING ((is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Society members can view parking slots on parking_slots (SELECT)
CREATE POLICY "Society members can view parking slots" ON public.parking_slots
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can update violations on parking_violations (UPDATE)
CREATE POLICY "Admins can update violations" ON public.parking_violations
  FOR UPDATE
  TO public
  USING ((is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())))
;
-- Policy: Members can report violations on parking_violations (INSERT)
CREATE POLICY "Members can report violations" ON public.parking_violations
  FOR INSERT
  TO public
  WITH CHECK (((reported_by = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Society members can view violations on parking_violations (SELECT)
CREATE POLICY "Society members can view violations" ON public.parking_violations
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can delete payment milestones on payment_milestones (DELETE)
CREATE POLICY "Admins can delete payment milestones" ON public.payment_milestones
  FOR DELETE
  TO public
  USING ((((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid())))
;
-- Policy: Admins can manage payment milestones on payment_milestones (INSERT)
CREATE POLICY "Admins can manage payment milestones" ON public.payment_milestones
  FOR INSERT
  TO public
  WITH CHECK ((can_write_to_society(auth.uid(), society_id) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))))
;
-- Policy: Admins can update payment milestones on payment_milestones (UPDATE)
CREATE POLICY "Admins can update payment milestones" ON public.payment_milestones
  FOR UPDATE
  TO public
  USING ((((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid())))
;
-- Policy: Society members can view payment milestones on payment_milestones (SELECT)
CREATE POLICY "Society members can view payment milestones" ON public.payment_milestones
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: System can create payment records on payment_records (INSERT)
CREATE POLICY "System can create payment records" ON public.payment_records
  FOR INSERT
  TO public
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: System can update payment records on payment_records (UPDATE)
CREATE POLICY "System can update payment records" ON public.payment_records
  FOR UPDATE
  TO public
  USING (((buyer_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can view their own payment records on payment_records (SELECT)
CREATE POLICY "Users can view their own payment records" ON public.payment_records
  FOR SELECT
  TO public
  USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = payment_records.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Sellers can view own settlements on payment_settlements (SELECT)
CREATE POLICY "Sellers can view own settlements" ON public.payment_settlements
  FOR SELECT
  TO authenticated
  USING ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
;
-- Policy: Admins can manage features on platform_features (ALL)
CREATE POLICY "Admins can manage features" ON public.platform_features
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Authenticated users can view features on platform_features (SELECT)
CREATE POLICY "Authenticated users can view features" ON public.platform_features
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Sellers can insert price history on price_history (INSERT)
CREATE POLICY "Sellers can insert price history" ON public.price_history
  FOR INSERT
  TO public
  WITH CHECK ((is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (products p
     JOIN seller_profiles sp ON ((sp.id = p.seller_id)))
  WHERE ((p.id = price_history.product_id) AND (sp.user_id = auth.uid()))))))
;
-- Policy: Sellers can view own price history on price_history (SELECT)
CREATE POLICY "Sellers can view own price history" ON public.price_history
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM (products p
     JOIN seller_profiles sp ON ((sp.id = p.seller_id)))
  WHERE ((p.id = price_history.product_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Anyone can view available products from approved sellers on products (SELECT)
CREATE POLICY "Anyone can view available products from approved sellers" ON public.products
  FOR SELECT
  TO public
  USING ((((approval_status = 'approved'::text) AND (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = products.seller_id) AND (sp.verification_status = 'approved'::verification_status))))) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = products.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Sellers can delete their own products on products (DELETE)
CREATE POLICY "Sellers can delete their own products" ON public.products
  FOR DELETE
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = products.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Sellers can manage their own products on products (INSERT)
CREATE POLICY "Sellers can manage their own products" ON public.products
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = products.seller_id) AND (sp.user_id = auth.uid())))))
;
-- Policy: Sellers can update their own products on products (UPDATE)
CREATE POLICY "Sellers can update their own products" ON public.products
  FOR UPDATE
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = products.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Users can insert their own profile on profiles (INSERT)
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT
  TO public
  WITH CHECK ((id = auth.uid()))
;
-- Policy: Users can update their own profile on profiles (UPDATE)
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE
  TO public
  USING (((id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can view all approved profiles on profiles (SELECT)
CREATE POLICY "Users can view all approved profiles" ON public.profiles
  FOR SELECT
  TO public
  USING (((verification_status = 'approved'::verification_status) OR (id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Admins can update answers on project_answers (UPDATE)
CREATE POLICY "Admins can update answers" ON public.project_answers
  FOR UPDATE
  TO public
  USING (((answered_by = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Authors and admins can delete answers on project_answers (DELETE)
CREATE POLICY "Authors and admins can delete answers" ON public.project_answers
  FOR DELETE
  TO public
  USING (((answered_by = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Society members can post answers on project_answers (INSERT)
CREATE POLICY "Society members can post answers" ON public.project_answers
  FOR INSERT
  TO public
  WITH CHECK (((answered_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM project_questions pq
  WHERE ((pq.id = project_answers.question_id) AND (pq.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Society members can view answers on project_answers (SELECT)
CREATE POLICY "Society members can view answers" ON public.project_answers
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM project_questions pq
  WHERE ((pq.id = project_answers.question_id) AND ((pq.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Admins can delete documents on project_documents (DELETE)
CREATE POLICY "Admins can delete documents" ON public.project_documents
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Admins can insert documents on project_documents (INSERT)
CREATE POLICY "Admins can insert documents" ON public.project_documents
  FOR INSERT
  TO public
  WITH CHECK (((uploaded_by = auth.uid()) AND can_write_to_society(auth.uid(), society_id) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR is_builder_for_society(auth.uid(), society_id))))
;
-- Policy: Admins can update documents on project_documents (UPDATE)
CREATE POLICY "Admins can update documents" ON public.project_documents
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Society members can view documents on project_documents (SELECT)
CREATE POLICY "Society members can view documents" ON public.project_documents
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can update questions on project_questions (UPDATE)
CREATE POLICY "Admins can update questions" ON public.project_questions
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Authors and admins can delete questions on project_questions (DELETE)
CREATE POLICY "Authors and admins can delete questions" ON public.project_questions
  FOR DELETE
  TO public
  USING (((asked_by = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid()))))
;
-- Policy: Members can ask questions on project_questions (INSERT)
CREATE POLICY "Members can ask questions" ON public.project_questions
  FOR INSERT
  TO public
  WITH CHECK (((asked_by = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Society members can view questions on project_questions (SELECT)
CREATE POLICY "Society members can view questions" ON public.project_questions
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can delete towers on project_towers (DELETE)
CREATE POLICY "Admins can delete towers" ON public.project_towers
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Admins can insert towers on project_towers (INSERT)
CREATE POLICY "Admins can insert towers" ON public.project_towers
  FOR INSERT
  TO public
  WITH CHECK (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Admins can update towers on project_towers (UPDATE)
CREATE POLICY "Admins can update towers" ON public.project_towers
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid())))
;
-- Policy: Society members can view towers on project_towers (SELECT)
CREATE POLICY "Society members can view towers" ON public.project_towers
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can view push logs on push_logs (ALL)
CREATE POLICY "Admins can view push logs" ON public.push_logs
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Users can insert own push logs on push_logs (INSERT)
CREATE POLICY "Users can insert own push logs" ON public.push_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can read own push logs on push_logs (SELECT)
CREATE POLICY "Users can read own push logs" ON public.push_logs
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()))
;
-- Policy: System manages rate limits on rate_limits (ALL)
CREATE POLICY "System manages rate limits" ON public.rate_limits
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Admins can update reports on reports (UPDATE)
CREATE POLICY "Admins can update reports" ON public.reports
  FOR UPDATE
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Users can create reports on reports (INSERT)
CREATE POLICY "Users can create reports" ON public.reports
  FOR INSERT
  TO public
  WITH CHECK ((reporter_id = auth.uid()))
;
-- Policy: Users can view their own reports on reports (SELECT)
CREATE POLICY "Users can view their own reports" ON public.reports
  FOR SELECT
  TO public
  USING (((reporter_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Admins can insert payments on resident_payments (INSERT)
CREATE POLICY "Admins can insert payments" ON public.resident_payments
  FOR INSERT
  TO public
  WITH CHECK ((((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR (resident_id = auth.uid())))
;
-- Policy: Residents can update own payments on resident_payments (UPDATE)
CREATE POLICY "Residents can update own payments" ON public.resident_payments
  FOR UPDATE
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Residents can view own payments on resident_payments (SELECT)
CREATE POLICY "Residents can view own payments" ON public.resident_payments
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Buyers can create reviews for completed orders on reviews (INSERT)
CREATE POLICY "Buyers can create reviews for completed orders" ON public.reviews
  FOR INSERT
  TO public
  WITH CHECK (((buyer_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = reviews.order_id) AND (o.buyer_id = auth.uid()) AND (o.status = 'completed'::order_status))))))
;
-- Policy: Users can view reviews in their society on reviews (SELECT)
CREATE POLICY "Users can view reviews in their society" ON public.reviews
  FOR SELECT
  TO public
  USING (((buyer_id = auth.uid()) OR is_admin(auth.uid()) OR ((is_hidden = false) AND (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = reviews.seller_id) AND ((sp.society_id IS NULL) OR (sp.society_id = get_user_society_id(auth.uid())))))))))
;
-- Policy: Admins can view search demand on search_demand_log (SELECT)
CREATE POLICY "Admins can view search demand" ON public.search_demand_log
  FOR SELECT
  TO public
  USING ((is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Authenticated can insert search demand on search_demand_log (INSERT)
CREATE POLICY "Authenticated can insert search demand" ON public.search_demand_log
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() IS NOT NULL))
;
-- Policy: Sellers can read unmet demand via RPC on search_demand_log (SELECT)
CREATE POLICY "Sellers can read unmet demand via RPC" ON public.search_demand_log
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.user_id = auth.uid()) AND (((sp.society_id IS NOT NULL) AND (sp.society_id = search_demand_log.society_id)) OR (sp.seller_type = 'commercial'::seller_type_enum) OR (search_demand_log.society_id IS NULL))))))
;
-- Policy: Admins can manage security staff on security_staff (ALL)
CREATE POLICY "Admins can manage security staff" ON public.security_staff
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Society members can view security staff on security_staff (SELECT)
CREATE POLICY "Society members can view security staff" ON public.security_staff
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Buyers can insert their own interactions on seller_contact_interactions (INSERT)
CREATE POLICY "Buyers can insert their own interactions" ON public.seller_contact_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Users can read their own interactions on seller_contact_interactions (SELECT)
CREATE POLICY "Users can read their own interactions" ON public.seller_contact_interactions
  FOR SELECT
  TO authenticated
  USING (((buyer_id = auth.uid()) OR (seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Conversation participants can read messages on seller_conversation_messages (SELECT)
CREATE POLICY "Conversation participants can read messages" ON public.seller_conversation_messages
  FOR SELECT
  TO authenticated
  USING ((conversation_id IN ( SELECT seller_conversations.id
   FROM seller_conversations
  WHERE ((seller_conversations.buyer_id = auth.uid()) OR (seller_conversations.seller_id IN ( SELECT sp.id
           FROM seller_profiles sp
          WHERE (sp.user_id = auth.uid())))))))
;
-- Policy: Conversation participants can send messages on seller_conversation_messages (INSERT)
CREATE POLICY "Conversation participants can send messages" ON public.seller_conversation_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND (conversation_id IN ( SELECT seller_conversations.id
   FROM seller_conversations
  WHERE ((seller_conversations.buyer_id = auth.uid()) OR (seller_conversations.seller_id IN ( SELECT sp.id
           FROM seller_profiles sp
          WHERE (sp.user_id = auth.uid()))))))))
;
-- Policy: Recipients can mark messages as read on seller_conversation_messages (UPDATE)
CREATE POLICY "Recipients can mark messages as read" ON public.seller_conversation_messages
  FOR UPDATE
  TO authenticated
  USING ((conversation_id IN ( SELECT seller_conversations.id
   FROM seller_conversations
  WHERE ((seller_conversations.buyer_id = auth.uid()) OR (seller_conversations.seller_id IN ( SELECT sp.id
           FROM seller_profiles sp
          WHERE (sp.user_id = auth.uid())))))))
;
-- Policy: Buyers can create conversations on seller_conversations (INSERT)
CREATE POLICY "Buyers can create conversations" ON public.seller_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Participants can read their conversations on seller_conversations (SELECT)
CREATE POLICY "Participants can read their conversations" ON public.seller_conversations
  FOR SELECT
  TO authenticated
  USING (((buyer_id = auth.uid()) OR (seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Participants can update their conversations on seller_conversations (UPDATE)
CREATE POLICY "Participants can update their conversations" ON public.seller_conversations
  FOR UPDATE
  TO authenticated
  USING (((buyer_id = auth.uid()) OR (seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Admins can manage seller form configs on seller_form_configs (ALL)
CREATE POLICY "Admins can manage seller form configs" ON public.seller_form_configs
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Anyone can read seller form configs on seller_form_configs (SELECT)
CREATE POLICY "Anyone can read seller form configs" ON public.seller_form_configs
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Sellers can insert their own licenses on seller_licenses (INSERT)
CREATE POLICY "Sellers can insert their own licenses" ON public.seller_licenses
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM seller_profiles
  WHERE ((seller_profiles.id = seller_licenses.seller_id) AND (seller_profiles.user_id = auth.uid())))))
;
-- Policy: Sellers can update their own licenses on seller_licenses (UPDATE)
CREATE POLICY "Sellers can update their own licenses" ON public.seller_licenses
  FOR UPDATE
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles
  WHERE ((seller_profiles.id = seller_licenses.seller_id) AND (seller_profiles.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Sellers can view their own licenses on seller_licenses (SELECT)
CREATE POLICY "Sellers can view their own licenses" ON public.seller_licenses
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles
  WHERE ((seller_profiles.id = seller_licenses.seller_id) AND (seller_profiles.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Anyone can view approved sellers on seller_profiles (SELECT)
CREATE POLICY "Anyone can view approved sellers" ON public.seller_profiles
  FOR SELECT
  TO public
  USING (((verification_status = 'approved'::verification_status) OR (user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Authenticated users can apply to be sellers on seller_profiles (INSERT)
CREATE POLICY "Authenticated users can apply to be sellers" ON public.seller_profiles
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Sellers can update their own profile on seller_profiles (UPDATE)
CREATE POLICY "Sellers can update their own profile" ON public.seller_profiles
  FOR UPDATE
  TO public
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Authenticated users can read recommendations on seller_recommendations (SELECT)
CREATE POLICY "Authenticated users can read recommendations" ON public.seller_recommendations
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Users can recommend sellers on seller_recommendations (INSERT)
CREATE POLICY "Users can recommend sellers" ON public.seller_recommendations
  FOR INSERT
  TO authenticated
  WITH CHECK ((recommender_id = auth.uid()))
;
-- Policy: Users can remove own recommendations on seller_recommendations (DELETE)
CREATE POLICY "Users can remove own recommendations" ON public.seller_recommendations
  FOR DELETE
  TO authenticated
  USING ((recommender_id = auth.uid()))
;
-- Policy: Sellers can view own reputation on seller_reputation_ledger (SELECT)
CREATE POLICY "Sellers can view own reputation" ON public.seller_reputation_ledger
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = seller_reputation_ledger.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Admins can manage settlements on seller_settlements (ALL)
CREATE POLICY "Admins can manage settlements" ON public.seller_settlements
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Sellers can view own settlements on seller_settlements (SELECT)
CREATE POLICY "Sellers can view own settlements" ON public.seller_settlements
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = seller_settlements.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: Authenticated users can read active addons on service_addons (SELECT)
CREATE POLICY "Authenticated users can read active addons" ON public.service_addons
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Sellers can manage addons for their products on service_addons (ALL)
CREATE POLICY "Sellers can manage addons for their products" ON public.service_addons
  FOR ALL
  TO authenticated
  USING ((product_id IN ( SELECT products.id
   FROM products
  WHERE (products.seller_id IN ( SELECT seller_profiles.id
           FROM seller_profiles
          WHERE (seller_profiles.user_id = auth.uid()))))))
  WITH CHECK ((product_id IN ( SELECT products.id
   FROM products
  WHERE (products.seller_id IN ( SELECT seller_profiles.id
           FROM seller_profiles
          WHERE (seller_profiles.user_id = auth.uid()))))))
;
-- Policy: sas_delete on service_availability_schedules (DELETE)
CREATE POLICY "sas_delete" ON public.service_availability_schedules
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_availability_schedules.seller_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: sas_insert on service_availability_schedules (INSERT)
CREATE POLICY "sas_insert" ON public.service_availability_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_availability_schedules.seller_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: sas_select on service_availability_schedules (SELECT)
CREATE POLICY "sas_select" ON public.service_availability_schedules
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: sas_update on service_availability_schedules (UPDATE)
CREATE POLICY "sas_update" ON public.service_availability_schedules
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_availability_schedules.seller_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: Authenticated can insert booking addons on service_booking_addons (INSERT)
CREATE POLICY "Authenticated can insert booking addons" ON public.service_booking_addons
  FOR INSERT
  TO authenticated
  WITH CHECK ((booking_id IN ( SELECT service_bookings.id
   FROM service_bookings
  WHERE (service_bookings.buyer_id = auth.uid()))))
;
-- Policy: Users can read their own booking addons on service_booking_addons (SELECT)
CREATE POLICY "Users can read their own booking addons" ON public.service_booking_addons
  FOR SELECT
  TO authenticated
  USING ((booking_id IN ( SELECT service_bookings.id
   FROM service_bookings
  WHERE ((service_bookings.buyer_id = auth.uid()) OR (service_bookings.seller_id IN ( SELECT seller_profiles.id
           FROM seller_profiles
          WHERE (seller_profiles.user_id = auth.uid())))))))
;
-- Policy: Admins can read all service bookings on service_bookings (SELECT)
CREATE POLICY "Admins can read all service bookings" ON public.service_bookings
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: sb_admin_select on service_bookings (SELECT)
CREATE POLICY "sb_admin_select" ON public.service_bookings
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: sb_buyer_insert on service_bookings (INSERT)
CREATE POLICY "sb_buyer_insert" ON public.service_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: sb_buyer_select on service_bookings (SELECT)
CREATE POLICY "sb_buyer_select" ON public.service_bookings
  FOR SELECT
  TO authenticated
  USING ((buyer_id = auth.uid()))
;
-- Policy: sb_insert on service_bookings (INSERT)
CREATE POLICY "sb_insert" ON public.service_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: sb_seller_select on service_bookings (SELECT)
CREATE POLICY "sb_seller_select" ON public.service_bookings
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_bookings.seller_id) AND (sp.user_id = auth.uid())))))
;
-- Policy: sb_seller_update on service_bookings (UPDATE)
CREATE POLICY "sb_seller_update" ON public.service_bookings
  FOR UPDATE
  TO authenticated
  USING ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
  WITH CHECK ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
;
-- Policy: sb_update on service_bookings (UPDATE)
CREATE POLICY "sb_update" ON public.service_bookings
  FOR UPDATE
  TO authenticated
  USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_bookings.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: service_listings_delete on service_listings (DELETE)
CREATE POLICY "service_listings_delete" ON public.service_listings
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (products p
     JOIN seller_profiles sp ON ((sp.id = p.seller_id)))
  WHERE ((p.id = service_listings.product_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: service_listings_insert on service_listings (INSERT)
CREATE POLICY "service_listings_insert" ON public.service_listings
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (products p
     JOIN seller_profiles sp ON ((sp.id = p.seller_id)))
  WHERE ((p.id = service_listings.product_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: service_listings_select on service_listings (SELECT)
CREATE POLICY "service_listings_select" ON public.service_listings
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: service_listings_update on service_listings (UPDATE)
CREATE POLICY "service_listings_update" ON public.service_listings
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (products p
     JOIN seller_profiles sp ON ((sp.id = p.seller_id)))
  WHERE ((p.id = service_listings.product_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: Buyers can manage their own recurring configs on service_recurring_configs (ALL)
CREATE POLICY "Buyers can manage their own recurring configs" ON public.service_recurring_configs
  FOR ALL
  TO authenticated
  USING ((buyer_id = auth.uid()))
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Buyers can read their own recurring configs on service_recurring_configs (SELECT)
CREATE POLICY "Buyers can read their own recurring configs" ON public.service_recurring_configs
  FOR SELECT
  TO authenticated
  USING ((buyer_id = auth.uid()))
;
-- Policy: Sellers can read recurring configs for their bookings on service_recurring_configs (SELECT)
CREATE POLICY "Sellers can read recurring configs for their bookings" ON public.service_recurring_configs
  FOR SELECT
  TO authenticated
  USING ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
;
-- Policy: slots_modify on service_slots (ALL)
CREATE POLICY "slots_modify" ON public.service_slots
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = service_slots.seller_id) AND ((sp.user_id = auth.uid()) OR is_admin(auth.uid()))))))
;
-- Policy: slots_select on service_slots (SELECT)
CREATE POLICY "slots_select" ON public.service_slots
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Authenticated users can read service staff on service_staff (SELECT)
CREATE POLICY "Authenticated users can read service staff" ON public.service_staff
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Sellers can manage their own staff on service_staff (ALL)
CREATE POLICY "Sellers can manage their own staff" ON public.service_staff
  FOR ALL
  TO authenticated
  USING ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
  WITH CHECK ((seller_id IN ( SELECT seller_profiles.id
   FROM seller_profiles
  WHERE (seller_profiles.user_id = auth.uid()))))
;
-- Policy: Buyers can insert own feedback on session_feedback (INSERT)
CREATE POLICY "Buyers can insert own feedback" ON public.session_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Buyers can read own feedback on session_feedback (SELECT)
CREATE POLICY "Buyers can read own feedback" ON public.session_feedback
  FOR SELECT
  TO authenticated
  USING ((buyer_id = auth.uid()))
;
-- Policy: Sellers can read feedback for their bookings on session_feedback (SELECT)
CREATE POLICY "Sellers can read feedback for their bookings" ON public.session_feedback
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (service_bookings sb
     JOIN seller_profiles sp ON ((sp.id = sb.seller_id)))
  WHERE ((sb.id = session_feedback.booking_id) AND (sp.user_id = auth.uid())))))
;
-- Policy: Users can endorse on skill_endorsements (INSERT)
CREATE POLICY "Users can endorse" ON public.skill_endorsements
  FOR INSERT
  TO public
  WITH CHECK (((endorser_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM skill_listings sl
  WHERE ((sl.id = skill_endorsements.skill_id) AND (sl.society_id = get_user_society_id(auth.uid())))))))
;
-- Policy: Users can remove endorsement on skill_endorsements (DELETE)
CREATE POLICY "Users can remove endorsement" ON public.skill_endorsements
  FOR DELETE
  TO public
  USING ((endorser_id = auth.uid()))
;
-- Policy: Users can view endorsements on skill_endorsements (SELECT)
CREATE POLICY "Users can view endorsements" ON public.skill_endorsements
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM skill_listings sl
  WHERE ((sl.id = skill_endorsements.skill_id) AND ((sl.society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid()))))))
;
-- Policy: Users can add skills on skill_listings (INSERT)
CREATE POLICY "Users can add skills" ON public.skill_listings
  FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Users can delete skills on skill_listings (DELETE)
CREATE POLICY "Users can delete skills" ON public.skill_listings
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can update skills on skill_listings (UPDATE)
CREATE POLICY "Users can update skills" ON public.skill_listings
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view skills on skill_listings (SELECT)
CREATE POLICY "Users can view skills" ON public.skill_listings
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Users can create their own holds on slot_holds (INSERT)
CREATE POLICY "Users can create their own holds" ON public.slot_holds
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id))
;
-- Policy: Users can delete their own holds on slot_holds (DELETE)
CREATE POLICY "Users can delete their own holds" ON public.slot_holds
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = user_id))
;
-- Policy: Users can read their own holds on slot_holds (SELECT)
CREATE POLICY "Users can read their own holds" ON public.slot_holds
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id))
;
-- Policy: Buyers can join waitlist on slot_waitlist (INSERT)
CREATE POLICY "Buyers can join waitlist" ON public.slot_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = buyer_id))
;
-- Policy: Buyers can leave waitlist on slot_waitlist (DELETE)
CREATE POLICY "Buyers can leave waitlist" ON public.slot_waitlist
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = buyer_id))
;
-- Policy: Buyers can view own waitlist on slot_waitlist (SELECT)
CREATE POLICY "Buyers can view own waitlist" ON public.slot_waitlist
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = buyer_id))
;
-- Policy: Admins can update snag tickets on snag_tickets (UPDATE)
CREATE POLICY "Admins can update snag tickets" ON public.snag_tickets
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR (reported_by = auth.uid()))))
;
-- Policy: Members can create snag tickets on snag_tickets (INSERT)
CREATE POLICY "Members can create snag tickets" ON public.snag_tickets
  FOR INSERT
  TO public
  WITH CHECK (((reported_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Users can view snag tickets on snag_tickets (SELECT)
CREATE POLICY "Users can view snag tickets" ON public.snag_tickets
  FOR SELECT
  TO public
  USING (((reported_by = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND is_admin(auth.uid()))))
;
-- Policy: Admins can manage societies on societies (ALL)
CREATE POLICY "Admins can manage societies" ON public.societies
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Anyone can view active societies on societies (SELECT)
CREATE POLICY "Anyone can view active societies" ON public.societies
  FOR SELECT
  TO public
  USING (((is_active = true) OR is_admin(auth.uid())))
;
-- Policy: Users can request societies on societies (INSERT)
CREATE POLICY "Users can request societies" ON public.societies
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() IS NOT NULL))
;
-- Policy: Society members can view activity on society_activity (SELECT)
CREATE POLICY "Society members can view activity" ON public.society_activity
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: System and admins can insert activity on society_activity (INSERT)
CREATE POLICY "System and admins can insert activity" ON public.society_activity
  FOR INSERT
  TO public
  WITH CHECK ((((society_id = get_user_society_id(auth.uid())) AND (actor_id = auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Society admins can insert on society_admins (INSERT)
CREATE POLICY "Society admins can insert" ON public.society_admins
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Society admins can update on society_admins (UPDATE)
CREATE POLICY "Society admins can update" ON public.society_admins
  FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: Society members can view admins on society_admins (SELECT)
CREATE POLICY "Society members can view admins" ON public.society_admins
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Society admins can manage budgets on society_budgets (ALL)
CREATE POLICY "Society admins can manage budgets" ON public.society_budgets
  FOR ALL
  TO public
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society members can view budgets on society_budgets (SELECT)
CREATE POLICY "Society members can view budgets" ON public.society_budgets
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can delete expenses on society_expenses (DELETE)
CREATE POLICY "Admins can delete expenses" ON public.society_expenses
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can insert expenses on society_expenses (INSERT)
CREATE POLICY "Admins can insert expenses" ON public.society_expenses
  FOR INSERT
  TO public
  WITH CHECK (((added_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can update expenses on society_expenses (UPDATE)
CREATE POLICY "Admins can update expenses" ON public.society_expenses
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Society members can view expenses on society_expenses (SELECT)
CREATE POLICY "Society members can view expenses" ON public.society_expenses
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can manage all overrides on society_feature_overrides (ALL)
CREATE POLICY "Admins can manage all overrides" ON public.society_feature_overrides
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Society admins can delete own overrides on society_feature_overrides (DELETE)
CREATE POLICY "Society admins can delete own overrides" ON public.society_feature_overrides
  FOR DELETE
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society admins can manage own overrides on society_feature_overrides (INSERT)
CREATE POLICY "Society admins can manage own overrides" ON public.society_feature_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society admins can update own overrides on society_feature_overrides (UPDATE)
CREATE POLICY "Society admins can update own overrides" ON public.society_feature_overrides
  FOR UPDATE
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society admins can view own overrides on society_feature_overrides (SELECT)
CREATE POLICY "Society admins can view own overrides" ON public.society_feature_overrides
  FOR SELECT
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society members can view overrides on society_feature_overrides (SELECT)
CREATE POLICY "Society members can view overrides" ON public.society_feature_overrides
  FOR SELECT
  TO authenticated
  USING ((get_user_society_id(auth.uid()) = society_id))
;
-- Policy: Admins can manage society features on society_features (ALL)
CREATE POLICY "Admins can manage society features" ON public.society_features
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Anyone can read society features on society_features (SELECT)
CREATE POLICY "Anyone can read society features" ON public.society_features
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Admins can delete income on society_income (DELETE)
CREATE POLICY "Admins can delete income" ON public.society_income
  FOR DELETE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can insert income on society_income (INSERT)
CREATE POLICY "Admins can insert income" ON public.society_income
  FOR INSERT
  TO public
  WITH CHECK (((added_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Admins can update income on society_income (UPDATE)
CREATE POLICY "Admins can update income" ON public.society_income
  FOR UPDATE
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))))
;
-- Policy: Society members can view income on society_income (SELECT)
CREATE POLICY "Society members can view income" ON public.society_income
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Society admins can manage notices on society_notices (ALL)
CREATE POLICY "Society admins can manage notices" ON public.society_notices
  FOR ALL
  TO public
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society members can view notices on society_notices (SELECT)
CREATE POLICY "Society members can view notices" ON public.society_notices
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins can manage report cards on society_report_cards (ALL)
CREATE POLICY "Admins can manage report cards" ON public.society_report_cards
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: Society members can view report cards on society_report_cards (SELECT)
CREATE POLICY "Society members can view report cards" ON public.society_report_cards
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Service role inserts reports on society_reports (INSERT)
CREATE POLICY "Service role inserts reports" ON public.society_reports
  FOR INSERT
  TO public
  WITH CHECK (true)
;
-- Policy: Society members can view reports on society_reports (SELECT)
CREATE POLICY "Society members can view reports" ON public.society_reports
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Society admins can delete categories on society_worker_categories (DELETE)
CREATE POLICY "Society admins can delete categories" ON public.society_worker_categories
  FOR DELETE
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society admins can manage categories on society_worker_categories (INSERT)
CREATE POLICY "Society admins can manage categories" ON public.society_worker_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society admins can update categories on society_worker_categories (UPDATE)
CREATE POLICY "Society admins can update categories" ON public.society_worker_categories
  FOR UPDATE
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
;
-- Policy: Society members can view categories on society_worker_categories (SELECT)
CREATE POLICY "Society members can view categories" ON public.society_worker_categories
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Platform admin full access workers on society_workers (ALL)
CREATE POLICY "Platform admin full access workers" ON public.society_workers
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Residents can view society workers on society_workers (SELECT)
CREATE POLICY "Residents can view society workers" ON public.society_workers
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) AND (is_available = true) AND (deactivated_at IS NULL)))
;
-- Policy: Society admin manages workers on society_workers (ALL)
CREATE POLICY "Society admin manages workers" ON public.society_workers
  FOR ALL
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
  WITH CHECK (is_society_admin(auth.uid(), society_id))
;
-- Policy: Worker can update own record on society_workers (UPDATE)
CREATE POLICY "Worker can update own record" ON public.society_workers
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Workers can view own record on society_workers (SELECT)
CREATE POLICY "Workers can view own record" ON public.society_workers
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()))
;
-- Policy: Users can manage own watchlist on stock_watchlist (ALL)
CREATE POLICY "Users can manage own watchlist" ON public.stock_watchlist
  FOR ALL
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: authenticated_read on subcategories (SELECT)
CREATE POLICY "authenticated_read" ON public.subcategories
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Buyers can view deliveries on subscription_deliveries (SELECT)
CREATE POLICY "Buyers can view deliveries" ON public.subscription_deliveries
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM subscriptions s
  WHERE ((s.id = subscription_deliveries.subscription_id) AND ((s.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM seller_profiles sp
          WHERE ((sp.id = s.seller_id) AND (sp.user_id = auth.uid())))))))) OR is_admin(auth.uid())))
;
-- Policy: Buyers can create subscriptions on subscriptions (INSERT)
CREATE POLICY "Buyers can create subscriptions" ON public.subscriptions
  FOR INSERT
  TO public
  WITH CHECK ((buyer_id = auth.uid()))
;
-- Policy: Buyers can update subscriptions on subscriptions (UPDATE)
CREATE POLICY "Buyers can update subscriptions" ON public.subscriptions
  FOR UPDATE
  TO public
  USING (((buyer_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Buyers can view subscriptions on subscriptions (SELECT)
CREATE POLICY "Buyers can view subscriptions" ON public.subscriptions
  FOR SELECT
  TO public
  USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM seller_profiles sp
  WHERE ((sp.id = subscriptions.seller_id) AND (sp.user_id = auth.uid())))) OR is_admin(auth.uid())))
;
-- Policy: authenticated_read on supported_languages (SELECT)
CREATE POLICY "authenticated_read" ON public.supported_languages
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Only admins can modify system settings on system_settings (ALL)
CREATE POLICY "Only admins can modify system settings" ON public.system_settings
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: System settings readable by everyone on system_settings (SELECT)
CREATE POLICY "System settings readable by everyone" ON public.system_settings
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Allow insert for all on test_results (INSERT)
CREATE POLICY "Allow insert for all" ON public.test_results
  FOR INSERT
  TO public
  WITH CHECK (true)
;
-- Policy: Allow read for authenticated on test_results (SELECT)
CREATE POLICY "Allow read for authenticated" ON public.test_results
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Only admins can view trigger errors on trigger_errors (SELECT)
CREATE POLICY "Only admins can view trigger errors" ON public.trigger_errors
  FOR SELECT
  TO public
  USING (is_admin(auth.uid()))
;
-- Policy: System can insert trigger errors on trigger_errors (INSERT)
CREATE POLICY "System can insert trigger errors" ON public.trigger_errors
  FOR INSERT
  TO public
  WITH CHECK (true)
;
-- Policy: Anyone can read trust tiers on trust_tier_config (SELECT)
CREATE POLICY "Anyone can read trust tiers" ON public.trust_tier_config
  FOR SELECT
  TO public
  USING (true)
;
-- Policy: Admins can read all feedback on user_feedback (SELECT)
CREATE POLICY "Admins can read all feedback" ON public.user_feedback
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()))
;
-- Policy: Users can insert their own feedback on user_feedback (INSERT)
CREATE POLICY "Users can insert their own feedback" ON public.user_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()))
;
-- Policy: Users can read their own feedback on user_feedback (SELECT)
CREATE POLICY "Users can read their own feedback" ON public.user_feedback
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()))
;
-- Policy: System can insert notifications on user_notifications (INSERT)
CREATE POLICY "System can insert notifications" ON public.user_notifications
  FOR INSERT
  TO public
  WITH CHECK (true)
;
-- Policy: Users can update own notifications on user_notifications (UPDATE)
CREATE POLICY "Users can update own notifications" ON public.user_notifications
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Users can view own notifications on user_notifications (SELECT)
CREATE POLICY "Users can view own notifications" ON public.user_notifications
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()))
;
-- Policy: Only admins can manage roles on user_roles (ALL)
CREATE POLICY "Only admins can manage roles" ON public.user_roles
  FOR ALL
  TO public
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Users can insert default buyer role on user_roles (INSERT)
CREATE POLICY "Users can insert default buyer role" ON public.user_roles
  FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND (role = 'buyer'::user_role)))
;
-- Policy: Users can view their own roles on user_roles (SELECT)
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT
  TO public
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Members can create visitor entries on visitor_entries (INSERT)
CREATE POLICY "Members can create visitor entries" ON public.visitor_entries
  FOR INSERT
  TO public
  WITH CHECK (((resident_id = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Residents can delete own visitors on visitor_entries (DELETE)
CREATE POLICY "Residents can delete own visitors" ON public.visitor_entries
  FOR DELETE
  TO public
  USING ((resident_id = auth.uid()))
;
-- Policy: Residents can update own visitors on visitor_entries (UPDATE)
CREATE POLICY "Residents can update own visitors" ON public.visitor_entries
  FOR UPDATE
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: Residents can view own visitors on visitor_entries (SELECT)
CREATE POLICY "Residents can view own visitors" ON public.visitor_entries
  FOR SELECT
  TO public
  USING (((resident_id = auth.uid()) OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))))
;
-- Policy: authenticated_read on visitor_types (SELECT)
CREATE POLICY "authenticated_read" ON public.visitor_types
  FOR SELECT
  TO authenticated
  USING (true)
;
-- Policy: Admins can create warnings on warnings (INSERT)
CREATE POLICY "Admins can create warnings" ON public.warnings
  FOR INSERT
  TO public
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Users can acknowledge their warnings on warnings (UPDATE)
CREATE POLICY "Users can acknowledge their warnings" ON public.warnings
  FOR UPDATE
  TO public
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Users can view their own warnings on warnings (SELECT)
CREATE POLICY "Users can view their own warnings" ON public.warnings
  FOR SELECT
  TO public
  USING (((user_id = auth.uid()) OR is_admin(auth.uid())))
;
-- Policy: Residents can mark worker attendance on worker_attendance (INSERT)
CREATE POLICY "Residents can mark worker attendance" ON public.worker_attendance
  FOR INSERT
  TO public
  WITH CHECK ((society_id = get_user_society_id(auth.uid())))
;
-- Policy: Society members can view worker attendance on worker_attendance (SELECT)
CREATE POLICY "Society members can view worker attendance" ON public.worker_attendance
  FOR SELECT
  TO public
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Security officers can insert entry logs on worker_entry_logs (INSERT)
CREATE POLICY "Security officers can insert entry logs" ON public.worker_entry_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_security_officer(auth.uid(), society_id) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Security officers can update entry logs on worker_entry_logs (UPDATE)
CREATE POLICY "Security officers can update entry logs" ON public.worker_entry_logs
  FOR UPDATE
  TO authenticated
  USING ((is_security_officer(auth.uid(), society_id) OR is_society_admin(auth.uid(), society_id)))
;
-- Policy: Society members can view entry logs on worker_entry_logs (SELECT)
CREATE POLICY "Society members can view entry logs" ON public.worker_entry_logs
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Admins and residents can delete flat assignments on worker_flat_assignments (DELETE)
CREATE POLICY "Admins and residents can delete flat assignments" ON public.worker_flat_assignments
  FOR DELETE
  TO authenticated
  USING ((is_society_admin(auth.uid(), society_id) OR (resident_id = auth.uid())))
;
-- Policy: Admins and residents can insert flat assignments on worker_flat_assignments (INSERT)
CREATE POLICY "Admins and residents can insert flat assignments" ON public.worker_flat_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_society_admin(auth.uid(), society_id) OR (resident_id = auth.uid())))
;
-- Policy: Admins and residents can update flat assignments on worker_flat_assignments (UPDATE)
CREATE POLICY "Admins and residents can update flat assignments" ON public.worker_flat_assignments
  FOR UPDATE
  TO authenticated
  USING ((is_society_admin(auth.uid(), society_id) OR (resident_id = auth.uid())))
;
-- Policy: Society members can view flat assignments on worker_flat_assignments (SELECT)
CREATE POLICY "Society members can view flat assignments" ON public.worker_flat_assignments
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Members can create job requests on worker_job_requests (INSERT)
CREATE POLICY "Members can create job requests" ON public.worker_job_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (((resident_id = auth.uid()) AND can_write_to_society(auth.uid(), society_id)))
;
-- Policy: Platform admin full access jobs on worker_job_requests (ALL)
CREATE POLICY "Platform admin full access jobs" ON public.worker_job_requests
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()))
;
-- Policy: Resident can update own job on worker_job_requests (UPDATE)
CREATE POLICY "Resident can update own job" ON public.worker_job_requests
  FOR UPDATE
  TO authenticated
  USING ((resident_id = auth.uid()))
  WITH CHECK ((resident_id = auth.uid()))
;
-- Policy: Resident can view own job requests on worker_job_requests (SELECT)
CREATE POLICY "Resident can view own job requests" ON public.worker_job_requests
  FOR SELECT
  TO authenticated
  USING ((resident_id = auth.uid()))
;
-- Policy: Society admin manages job requests on worker_job_requests (ALL)
CREATE POLICY "Society admin manages job requests" ON public.worker_job_requests
  FOR ALL
  TO authenticated
  USING (is_society_admin(auth.uid(), society_id))
  WITH CHECK (is_society_admin(auth.uid(), society_id))
;
-- Policy: Worker can update job on worker_job_requests (UPDATE)
CREATE POLICY "Worker can update job" ON public.worker_job_requests
  FOR UPDATE
  TO authenticated
  USING (((accepted_by = auth.uid()) OR ((status = 'open'::text) AND (society_id IN ( SELECT sw.society_id
   FROM society_workers sw
  WHERE ((sw.user_id = auth.uid()) AND (sw.deactivated_at IS NULL)))))))
  WITH CHECK (true)
;
-- Policy: Worker can view accepted jobs on worker_job_requests (SELECT)
CREATE POLICY "Worker can view accepted jobs" ON public.worker_job_requests
  FOR SELECT
  TO authenticated
  USING ((accepted_by = auth.uid()))
;
-- Policy: Worker can view open jobs in society on worker_job_requests (SELECT)
CREATE POLICY "Worker can view open jobs in society" ON public.worker_job_requests
  FOR SELECT
  TO authenticated
  USING (((status = 'open'::text) AND (society_id IN ( SELECT sw.society_id
   FROM society_workers sw
  WHERE ((sw.user_id = auth.uid()) AND (sw.deactivated_at IS NULL))))))
;
-- Policy: Society admins can manage worker leaves on worker_leave_records (ALL)
CREATE POLICY "Society admins can manage worker leaves" ON public.worker_leave_records
  FOR ALL
  TO public
  USING ((is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM society_workers w
  WHERE ((w.id = worker_leave_records.worker_id) AND is_society_admin(auth.uid(), w.society_id))))))
;
-- Policy: Society members can view worker leaves on worker_leave_records (SELECT)
CREATE POLICY "Society members can view worker leaves" ON public.worker_leave_records
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM society_workers w
  WHERE ((w.id = worker_leave_records.worker_id) AND (w.society_id = get_user_society_id(auth.uid()))))) OR is_admin(auth.uid())))
;
-- Policy: Residents can rate workers on worker_ratings (INSERT)
CREATE POLICY "Residents can rate workers" ON public.worker_ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (((rated_by = auth.uid()) AND (society_id = get_user_society_id(auth.uid()))))
;
-- Policy: Society members can view ratings on worker_ratings (SELECT)
CREATE POLICY "Society members can view ratings" ON public.worker_ratings
  FOR SELECT
  TO authenticated
  USING (((society_id = get_user_society_id(auth.uid())) OR is_admin(auth.uid())))
;
-- Policy: Society admins can manage salary records on worker_salary_records (ALL)
CREATE POLICY "Society admins can manage salary records" ON public.worker_salary_records
  FOR ALL
  TO public
  USING ((is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM society_workers w
  WHERE ((w.id = worker_salary_records.worker_id) AND is_society_admin(auth.uid(), w.society_id))))))
;
-- Policy: Society members can view salary records on worker_salary_records (SELECT)
CREATE POLICY "Society members can view salary records" ON public.worker_salary_records
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM society_workers w
  WHERE ((w.id = worker_salary_records.worker_id) AND (is_society_admin(auth.uid(), w.society_id) OR (w.society_id = get_user_society_id(auth.uid())))))) OR is_admin(auth.uid())))
;]]