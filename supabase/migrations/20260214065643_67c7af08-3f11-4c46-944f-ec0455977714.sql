
-- ============================================================
-- PRIORITY 1: Audit Log Table
-- ============================================================
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  society_id uuid REFERENCES public.societies(id),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Platform admins and society admins can view audit logs for their society
CREATE POLICY "Admins can view audit logs"
ON public.audit_log FOR SELECT
USING (
  is_admin(auth.uid())
  OR is_society_admin(auth.uid(), society_id)
);

-- Insert allowed for authenticated users (logged via app logic)
CREATE POLICY "Authenticated users can insert audit logs"
ON public.audit_log FOR INSERT
WITH CHECK (actor_id = auth.uid());

CREATE INDEX idx_audit_log_society ON public.audit_log(society_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON public.audit_log(target_type, target_id);

-- ============================================================
-- PRIORITY 2: Fix societies RLS for Society Admins
-- ============================================================
CREATE POLICY "Society admins can update their society"
ON public.societies FOR UPDATE
USING (is_society_admin(auth.uid(), id))
WITH CHECK (is_society_admin(auth.uid(), id));

-- ============================================================
-- PRIORITY 3: Add society_id to orders
-- ============================================================
ALTER TABLE public.orders ADD COLUMN society_id uuid REFERENCES public.societies(id);

CREATE INDEX idx_orders_society ON public.orders(society_id);
CREATE INDEX idx_orders_buyer_status ON public.orders(buyer_id, status);
CREATE INDEX idx_orders_seller_status ON public.orders(seller_id, status);

-- Trigger to auto-populate society_id from seller's profile
CREATE OR REPLACE FUNCTION public.set_order_society_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL AND NEW.society_id IS NULL THEN
    SELECT society_id INTO NEW.society_id
    FROM public.seller_profiles
    WHERE id = NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_order_society_id
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_society_id();

-- Backfill existing orders with society_id
UPDATE public.orders o
SET society_id = sp.society_id
FROM public.seller_profiles sp
WHERE o.seller_id = sp.id AND o.society_id IS NULL;

-- ============================================================
-- PRIORITY 4: Consolidated Auth Hydration Function
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_auth_context(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
  _profile jsonb;
  _society jsonb;
  _roles jsonb;
  _seller_profiles jsonb;
  _society_admin jsonb;
  _builder_ids jsonb;
BEGIN
  -- Profile
  SELECT to_jsonb(p.*) INTO _profile
  FROM profiles p WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('profile', null);
  END IF;

  -- Society
  IF (_profile->>'society_id') IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM societies s WHERE s.id = (_profile->>'society_id')::uuid;

    -- Society admin role
    SELECT to_jsonb(sa.*) INTO _society_admin
    FROM society_admins sa
    WHERE sa.user_id = _user_id AND sa.society_id = (_profile->>'society_id')::uuid;
  END IF;

  -- Roles
  SELECT COALESCE(jsonb_agg(ur.role), '[]'::jsonb) INTO _roles
  FROM user_roles ur WHERE ur.user_id = _user_id;

  -- Seller profiles
  SELECT COALESCE(jsonb_agg(to_jsonb(sp.*) ORDER BY sp.created_at), '[]'::jsonb) INTO _seller_profiles
  FROM seller_profiles sp WHERE sp.user_id = _user_id;

  -- Builder IDs
  SELECT COALESCE(jsonb_agg(bm.builder_id), '[]'::jsonb) INTO _builder_ids
  FROM builder_members bm WHERE bm.user_id = _user_id;

  RETURN jsonb_build_object(
    'profile', _profile,
    'society', _society,
    'roles', _roles,
    'seller_profiles', _seller_profiles,
    'society_admin_role', _society_admin,
    'builder_ids', _builder_ids
  );
END;
$$;

-- ============================================================
-- PRIORITY 5: Admin Appointment Controls
-- ============================================================
ALTER TABLE public.societies ADD COLUMN max_society_admins integer NOT NULL DEFAULT 5;

-- Validation trigger for max admins
CREATE OR REPLACE FUNCTION public.validate_society_admin_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current_count integer;
  _max_allowed integer;
BEGIN
  SELECT COUNT(*) INTO _current_count
  FROM public.society_admins
  WHERE society_id = NEW.society_id;

  SELECT max_society_admins INTO _max_allowed
  FROM public.societies
  WHERE id = NEW.society_id;

  IF _current_count >= COALESCE(_max_allowed, 5) THEN
    RAISE EXCEPTION 'Maximum number of society admins (%) reached for this society', _max_allowed;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_society_admin_limit
BEFORE INSERT ON public.society_admins
FOR EACH ROW
EXECUTE FUNCTION public.validate_society_admin_limit();

-- Add soft delete to society_admins
ALTER TABLE public.society_admins ADD COLUMN deactivated_at timestamptz;

-- ============================================================
-- PRIORITY 6: Missing Composite Indexes
-- ============================================================
CREATE INDEX idx_dispute_tickets_society_status ON public.dispute_tickets(society_id, status);
CREATE INDEX idx_dispute_tickets_society_created ON public.dispute_tickets(society_id, created_at DESC);
CREATE INDEX idx_snag_tickets_society_status ON public.snag_tickets(society_id, status);
CREATE INDEX idx_society_expenses_society_created ON public.society_expenses(society_id, created_at DESC);
CREATE INDEX idx_construction_milestones_society ON public.construction_milestones(society_id, created_at DESC);
CREATE INDEX idx_user_roles_user_role ON public.user_roles(user_id, role);
CREATE INDEX idx_profiles_society_verification ON public.profiles(society_id, verification_status);
CREATE INDEX idx_seller_profiles_society_verification ON public.seller_profiles(society_id, verification_status);
