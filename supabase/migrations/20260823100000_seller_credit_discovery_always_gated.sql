-- Discovery activation is independent of the Spend kill-switch.
-- Spend OFF only stops charging; stores still need Sociva Credits to be buyer-visible.

CREATE OR REPLACE FUNCTION public.seller_credit_activation_satisfied(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_available numeric;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT amount INTO v_amount
  FROM public.seller_billing_rules
  WHERE event_type = 'ORDER_COMPLETED' AND enabled IS TRUE;
  v_amount := COALESCE(v_amount, 0);

  SELECT available INTO v_available
  FROM public.seller_credit_accounts
  WHERE seller_id = p_seller_id;

  RETURN COALESCE(v_available, 0) >= v_amount
     AND COALESCE(v_available, 0) > 0;
END;
$$;

COMMENT ON FUNCTION public.seller_credit_activation_satisfied(uuid) IS
  'True when seller available Sociva Credits meet the activation floor. Always enforced for discovery; independent of seller_credit_spend_enabled.';

-- Defense in depth: buyer product SELECT must also require credit activation
-- (discovery RPCs already call seller_is_discoverable_to_buyer).
DROP POLICY IF EXISTS "Anyone can view available products from approved sellers" ON public.products;

CREATE POLICY "Anyone can view available products from approved sellers"
ON public.products FOR SELECT
USING (
  (
    approval_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = products.seller_id
        AND sp.verification_status = 'approved'
        AND public.seller_credit_activation_satisfied(sp.id)
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = products.seller_id
      AND sp.user_id = auth.uid()
  )
  OR public.is_admin(auth.uid())
);
