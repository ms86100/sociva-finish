-- Fix O1: Allow reviews on delivered orders (not just completed)
DROP POLICY IF EXISTS "Buyers can create reviews for completed orders" ON public.reviews;

CREATE POLICY "Buyers can create reviews for completed or delivered orders"
ON public.reviews
FOR INSERT
WITH CHECK (
  buyer_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = reviews.order_id
      AND orders.buyer_id = auth.uid()
      AND orders.status IN ('completed', 'delivered')
  )
);