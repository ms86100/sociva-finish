-- Sellers and delivery partners must be able to read their delivery_assignments
-- (buyer-only SELECT blocked SellerGPSTracker from resolving assignment IDs).

DROP POLICY IF EXISTS delivery_read_seller ON public.delivery_assignments;
CREATE POLICY delivery_read_seller
  ON public.delivery_assignments
  FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT o.id
      FROM public.orders o
      JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS delivery_read_partner ON public.delivery_assignments;
CREATE POLICY delivery_read_partner
  ON public.delivery_assignments
  FOR SELECT
  TO authenticated
  USING (
    partner_id IN (
      SELECT dpp.id
      FROM public.delivery_partner_pool dpp
      WHERE dpp.user_id = auth.uid()
    )
    OR rider_id IN (
      SELECT dpp.id
      FROM public.delivery_partner_pool dpp
      WHERE dpp.user_id = auth.uid()
    )
  );

-- Sellers also need to see location rows for their own assignments (buyer already can).
DROP POLICY IF EXISTS delivery_read_locations_seller ON public.delivery_locations;
CREATE POLICY delivery_read_locations_seller
  ON public.delivery_locations
  FOR SELECT
  TO authenticated
  USING (
    assignment_id IN (
      SELECT da.id
      FROM public.delivery_assignments da
      JOIN public.orders o ON o.id = da.order_id
      JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE sp.user_id = auth.uid()
    )
  );
