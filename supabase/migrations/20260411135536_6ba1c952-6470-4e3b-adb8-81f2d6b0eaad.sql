
-- Step 1: Create a security-definer function to check if the current auth user
-- owns the seller profile associated with a refund request row.
CREATE OR REPLACE FUNCTION public.is_seller_for_refund(_seller_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.seller_profiles
    WHERE id = _seller_id
      AND user_id = auth.uid()
  );
$$;

-- Step 2: Drop the broken seller SELECT policy
DROP POLICY IF EXISTS "Sellers can view refunds for their orders" ON public.refund_requests;

-- Step 3: Create corrected seller SELECT policy
CREATE POLICY "Sellers can view refunds for their orders"
ON public.refund_requests
FOR SELECT
TO authenticated
USING (public.is_seller_for_refund(seller_id));

-- Step 4: Create seller UPDATE policy so they can approve/reject
CREATE POLICY "Sellers can update refunds for their orders"
ON public.refund_requests
FOR UPDATE
TO authenticated
USING (public.is_seller_for_refund(seller_id))
WITH CHECK (public.is_seller_for_refund(seller_id));
