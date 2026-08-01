
-- Allow buyers to review orders that are delivered/buyer_received/completed (not just terminal+success)
DROP POLICY IF EXISTS "Buyers can create reviews for completed orders" ON public.reviews;

CREATE POLICY "Buyers can create reviews for fulfilled orders"
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  buyer_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = reviews.order_id
      AND o.buyer_id = auth.uid()
      AND (
        (o.status)::text IN ('completed','delivered','buyer_received','seller_verified')
        OR EXISTS (
          SELECT 1 FROM public.category_status_flows csf
          WHERE csf.transaction_type = o.transaction_type
            AND (o.status)::text = ANY (csf.statuses)
            AND csf.is_terminal = true
            AND csf.is_success = true
        )
      )
  )
);
