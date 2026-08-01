
CREATE POLICY "Buyers can update delivery coords on own orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (buyer_id = auth.uid())
WITH CHECK (buyer_id = auth.uid());
