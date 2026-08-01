-- Fix reviews INSERT policy: allow buyers to review orders that have reached
-- ANY terminal success status defined in category_status_flows (e.g. delivered,
-- completed, buyer_received), not just the legacy 'completed' status.
DROP POLICY IF EXISTS "Buyers can create reviews for completed orders" ON public.reviews;

CREATE POLICY "Buyers can create reviews for completed orders"
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  buyer_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = reviews.order_id
      AND o.buyer_id = auth.uid()
      AND (
        o.status::text = 'completed'
        OR EXISTS (
          SELECT 1 FROM public.category_status_flows csf
          WHERE csf.transaction_type = o.transaction_type::text
            AND o.status::text = ANY(csf.statuses)
            AND csf.is_terminal = true
            AND csf.is_success = true
        )
      )
  )
);