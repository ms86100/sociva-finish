
-- ============================================================
-- PHASE A: CRITICAL FIXES
-- ============================================================

-- Fix 1: is_society_admin() must check deactivated_at IS NULL
CREATE OR REPLACE FUNCTION public.is_society_admin(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.society_admins
    WHERE user_id = _user_id AND society_id = _society_id AND deactivated_at IS NULL
  ) OR public.is_admin(_user_id)
$function$;

-- Fix 2: Products SELECT - scope by society
DROP POLICY IF EXISTS "Anyone can view available products from approved sellers" ON products;
CREATE POLICY "Anyone can view available products from approved sellers"
ON products FOR SELECT
USING (
  (EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.verification_status = 'approved'
      AND seller_profiles.society_id = get_user_society_id(auth.uid())
  ))
  OR (EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.user_id = auth.uid()
  ))
  OR is_admin(auth.uid())
);

-- Fix 3: seller_profiles UPDATE - include society admins
DROP POLICY IF EXISTS "Sellers can update their own profile" ON seller_profiles;
CREATE POLICY "Sellers and society admins can update profiles"
ON seller_profiles FOR UPDATE
USING (
  user_id = auth.uid()
  OR is_admin(auth.uid())
  OR is_society_admin(auth.uid(), society_id)
);

-- Fix 4 (indexes already verified as applied - no action needed)

-- ============================================================
-- PHASE B: SOCIETY ADMIN POLICY FIXES
-- ============================================================

-- Fix 5: society_expenses - add society admin write access
DROP POLICY IF EXISTS "Admins can insert expenses" ON society_expenses;
CREATE POLICY "Admins and society admins can insert expenses"
ON society_expenses FOR INSERT
WITH CHECK (
  added_by = auth.uid()
  AND society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can update expenses" ON society_expenses;
CREATE POLICY "Admins and society admins can update expenses"
ON society_expenses FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete expenses" ON society_expenses;
CREATE POLICY "Admins and society admins can delete expenses"
ON society_expenses FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- Fix 6: snag_tickets - add society admin SELECT/UPDATE
DROP POLICY IF EXISTS "Reporters can view own snag tickets" ON snag_tickets;
CREATE POLICY "Reporters and society admins can view snag tickets"
ON snag_tickets FOR SELECT
USING (
  reported_by = auth.uid()
  OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
);

DROP POLICY IF EXISTS "Admins can update snag tickets" ON snag_tickets;
CREATE POLICY "Admins and society admins can update snag tickets"
ON snag_tickets FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id) OR reported_by = auth.uid())
);

-- Fix 7: society_income - add society admin write access
DROP POLICY IF EXISTS "Admins can insert income" ON society_income;
CREATE POLICY "Admins and society admins can insert income"
ON society_income FOR INSERT
WITH CHECK (
  added_by = auth.uid()
  AND society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can update income" ON society_income;
CREATE POLICY "Admins and society admins can update income"
ON society_income FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete income" ON society_income;
CREATE POLICY "Admins and society admins can delete income"
ON society_income FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- Fix 8: reviews SELECT - scope by society
DROP POLICY IF EXISTS "Anyone can view non-hidden reviews" ON reviews;
CREATE POLICY "Users can view reviews in their society"
ON reviews FOR SELECT
USING (
  buyer_id = auth.uid()
  OR is_admin(auth.uid())
  OR (is_hidden = false AND EXISTS (
    SELECT 1 FROM seller_profiles sp
    WHERE sp.id = reviews.seller_id
      AND sp.society_id = get_user_society_id(auth.uid())
  ))
);

-- ============================================================
-- PHASE C: WARNINGS SOCIETY ADMIN ACCESS
-- ============================================================

-- Fix 10: warnings - society admin CREATE
DROP POLICY IF EXISTS "Admins can create warnings" ON warnings;
CREATE POLICY "Admins and society admins can create warnings"
ON warnings FOR INSERT
WITH CHECK (
  is_admin(auth.uid())
  OR is_society_admin(auth.uid(), (SELECT society_id FROM profiles WHERE id = warnings.user_id))
);
