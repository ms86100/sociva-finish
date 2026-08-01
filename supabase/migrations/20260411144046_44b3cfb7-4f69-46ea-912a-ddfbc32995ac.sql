
-- Seller-owned
CREATE POLICY "seller_read_reputation" ON public.seller_reputation_ledger FOR SELECT TO authenticated USING (seller_id IN (SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()));
CREATE POLICY "seller_read_settlements" ON public.seller_settlements FOR SELECT TO authenticated USING (seller_id IN (SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()));
CREATE POLICY "seller_read_pay_settlements" ON public.payment_settlements FOR SELECT TO authenticated USING (seller_id IN (SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()));

-- seller_form_configs uses society_id not seller_id
CREATE POLICY "soc_read_form_configs" ON public.seller_form_configs FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_insert_form_configs" ON public.seller_form_configs FOR INSERT TO authenticated WITH CHECK (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_update_form_configs" ON public.seller_form_configs FOR UPDATE TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));

-- Service bookings
CREATE POLICY "booking_read_own" ON public.service_bookings FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR seller_id IN (SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()));
CREATE POLICY "booking_update_seller" ON public.service_bookings FOR UPDATE TO authenticated USING (seller_id IN (SELECT sp.id FROM public.seller_profiles sp WHERE sp.user_id = auth.uid()));

-- Delivery
CREATE POLICY "delivery_read_buyer" ON public.delivery_assignments FOR SELECT TO authenticated USING (order_id IN (SELECT o.id FROM public.orders o WHERE o.buyer_id = auth.uid()));
CREATE POLICY "delivery_read_locations" ON public.delivery_locations FOR SELECT TO authenticated USING (assignment_id IN (SELECT da.id FROM public.delivery_assignments da JOIN public.orders o ON da.order_id = o.id WHERE o.buyer_id = auth.uid()));
CREATE POLICY "soc_read_del_pool" ON public.delivery_partner_pool FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "soc_read_del_partners" ON public.delivery_partners FOR SELECT TO authenticated USING (society_id = public.get_user_society_id(auth.uid()));
CREATE POLICY "delivery_read_tracking" ON public.delivery_tracking_logs FOR SELECT TO authenticated USING (assignment_id IN (SELECT da.id FROM public.delivery_assignments da JOIN public.orders o ON da.order_id = o.id WHERE o.buyer_id = auth.uid()));
