-- Staging only: admin Users directory was timing out because the profiles SELECT
-- policy OR-evaluated seller_has_order_with_buyer() on every row.
-- Short-circuit platform admins first. Non-admin access is unchanged.

DROP POLICY IF EXISTS "Users can view own or same-society approved profiles" ON public.profiles;
CREATE POLICY "Users can view own or same-society approved profiles"
  ON public.profiles
  FOR SELECT
  USING (
    CASE
      WHEN public.is_admin((SELECT auth.uid())) THEN true
      WHEN id = (SELECT auth.uid()) THEN true
      WHEN public.seller_has_order_with_buyer(id) THEN true
      ELSE (
        verification_status = 'approved'
        AND society_id IS NOT NULL
        AND society_id = public.get_user_society_id((SELECT auth.uid()))
      )
    END
  );
