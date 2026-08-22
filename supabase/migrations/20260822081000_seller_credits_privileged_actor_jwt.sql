-- SECURITY DEFINER runs as the function owner (postgres). Checking
-- current_user IN ('postgres', ...) therefore authorized every authenticated
-- caller of admin_adjust_seller_credits / reverse_seller_credit_charge.
-- Authorize from the JWT / session, not the definer role.

CREATE OR REPLACE FUNCTION public.seller_credit_is_privileged_actor()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN public.is_admin(auth.uid());
  END IF;

  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_jwt_role IN ('anon', 'authenticated') THEN
    RETURN false;
  END IF;

  RETURN session_user IN ('postgres', 'supabase_admin');
END;
$$;

DROP POLICY IF EXISTS seller_billing_rules_select ON public.seller_billing_rules;
CREATE POLICY seller_billing_rules_select ON public.seller_billing_rules
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS seller_credit_thresholds_select ON public.seller_credit_thresholds;
CREATE POLICY seller_credit_thresholds_select ON public.seller_credit_thresholds
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS seller_credit_packages_select ON public.seller_credit_packages;
CREATE POLICY seller_credit_packages_select ON public.seller_credit_packages
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.seller_profiles
        WHERE user_id = auth.uid()
      )
    )
  );
