
-- =============================================
-- PHASE 1: Society Admin Infrastructure
-- =============================================

-- 1. Create society_admins table
CREATE TABLE public.society_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'moderator')),
  appointed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, user_id)
);

ALTER TABLE public.society_admins ENABLE ROW LEVEL SECURITY;

-- 2. Create is_society_admin security definer function
CREATE OR REPLACE FUNCTION public.is_society_admin(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.society_admins
    WHERE user_id = _user_id AND society_id = _society_id
  ) OR public.is_admin(_user_id)
$$;

-- 3. Create can_manage_society security definer function
CREATE OR REPLACE FUNCTION public.can_manage_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_society_admin(_user_id, _society_id)
$$;

-- 4. RLS policies for society_admins table
CREATE POLICY "Society admins visible to same society members"
ON public.society_admins FOR SELECT
USING (
  society_id = get_user_society_id(auth.uid())
  OR is_admin(auth.uid())
);

CREATE POLICY "Platform admins and society admins can insert"
ON public.society_admins FOR INSERT
WITH CHECK (
  is_society_admin(auth.uid(), society_id)
);

CREATE POLICY "Platform admins and society admins can delete"
ON public.society_admins FOR DELETE
USING (
  is_society_admin(auth.uid(), society_id)
);

CREATE POLICY "Platform admins and society admins can update"
ON public.society_admins FOR UPDATE
USING (
  is_society_admin(auth.uid(), society_id)
);

-- =============================================
-- 5. Add auto_approve and approval_method to societies
-- =============================================
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS auto_approve_residents boolean NOT NULL DEFAULT false;
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS approval_method text NOT NULL DEFAULT 'manual';

-- =============================================
-- 6. Update RLS policies to accept society admins
-- =============================================

-- profiles: society admins can update profiles in their society (for approving users)
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (
  id = auth.uid()
  OR is_admin(auth.uid())
  OR is_society_admin(auth.uid(), society_id)
);

-- seller_profiles: need to check existing policies first
-- dispute_tickets: society admins can update
DROP POLICY IF EXISTS "Admins can update tickets in their society" ON public.dispute_tickets;
CREATE POLICY "Admins can update tickets in their society"
ON public.dispute_tickets FOR UPDATE
USING (
  (society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- dispute_tickets: society admins can view all tickets in their society
DROP POLICY IF EXISTS "Users can view own tickets" ON public.dispute_tickets;
CREATE POLICY "Users can view own tickets"
ON public.dispute_tickets FOR SELECT
USING (
  submitted_by = auth.uid()
  OR ((society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id)))
);

-- construction_milestones: society admins can manage
DROP POLICY IF EXISTS "Admins can create milestones" ON public.construction_milestones;
CREATE POLICY "Admins can create milestones"
ON public.construction_milestones FOR INSERT
WITH CHECK (
  posted_by = auth.uid()
  AND society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can update milestones" ON public.construction_milestones;
CREATE POLICY "Admins can update milestones"
ON public.construction_milestones FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete milestones" ON public.construction_milestones;
CREATE POLICY "Admins can delete milestones"
ON public.construction_milestones FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- project_documents: society admins can manage
DROP POLICY IF EXISTS "Admins can insert documents" ON public.project_documents;
CREATE POLICY "Admins can insert documents"
ON public.project_documents FOR INSERT
WITH CHECK (
  society_id = get_user_society_id(auth.uid())
  AND uploaded_by = auth.uid()
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can update documents" ON public.project_documents;
CREATE POLICY "Admins can update documents"
ON public.project_documents FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete documents" ON public.project_documents;
CREATE POLICY "Admins can delete documents"
ON public.project_documents FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- emergency_broadcasts: society admins can create
DROP POLICY IF EXISTS "Admins can create broadcasts" ON public.emergency_broadcasts;
CREATE POLICY "Admins can create broadcasts"
ON public.emergency_broadcasts FOR INSERT
WITH CHECK (
  society_id = get_user_society_id(auth.uid())
  AND sent_by = auth.uid()
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete broadcasts" ON public.emergency_broadcasts;
CREATE POLICY "Admins can delete broadcasts"
ON public.emergency_broadcasts FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- maintenance_dues: society admins can manage
DROP POLICY IF EXISTS "Admins can insert dues" ON public.maintenance_dues;
CREATE POLICY "Admins can insert dues"
ON public.maintenance_dues FOR INSERT
WITH CHECK (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can update dues" ON public.maintenance_dues;
CREATE POLICY "Admins can update dues"
ON public.maintenance_dues FOR UPDATE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

DROP POLICY IF EXISTS "Admins can delete dues" ON public.maintenance_dues;
CREATE POLICY "Admins can delete dues"
ON public.maintenance_dues FOR DELETE
USING (
  society_id = get_user_society_id(auth.uid())
  AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))
);

-- expense_flags: society admins can update
DROP POLICY IF EXISTS "Admins can update flags" ON public.expense_flags;
CREATE POLICY "Admins can update flags"
ON public.expense_flags FOR UPDATE
USING (
  is_admin(auth.uid())
  OR is_society_admin(auth.uid(), (SELECT se.society_id FROM society_expenses se WHERE se.id = expense_flags.expense_id))
);

-- dispute_comments: society admins can participate
DROP POLICY IF EXISTS "Users can add comments to accessible tickets" ON public.dispute_comments;
CREATE POLICY "Users can add comments to accessible tickets"
ON public.dispute_comments FOR INSERT
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM dispute_tickets dt
    WHERE dt.id = dispute_comments.ticket_id
    AND (
      dt.submitted_by = auth.uid()
      OR ((dt.society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), dt.society_id)))
    )
  )
);

DROP POLICY IF EXISTS "Users can view comments on accessible tickets" ON public.dispute_comments;
CREATE POLICY "Users can view comments on accessible tickets"
ON public.dispute_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM dispute_tickets dt
    WHERE dt.id = dispute_comments.ticket_id
    AND (
      dt.submitted_by = auth.uid()
      OR ((dt.society_id = get_user_society_id(auth.uid())) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), dt.society_id)))
    )
  )
);

-- =============================================
-- 7. Auto-approve trigger for profiles
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_approve_resident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _auto_approve boolean;
BEGIN
  IF NEW.society_id IS NOT NULL THEN
    SELECT auto_approve_residents INTO _auto_approve
    FROM public.societies WHERE id = NEW.society_id;
    
    IF _auto_approve = true THEN
      NEW.verification_status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_approve_resident
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.auto_approve_resident();

-- =============================================
-- PHASE 3: Builder Infrastructure
-- =============================================

-- builders table
CREATE TABLE public.builders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  contact_email text,
  contact_phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.builders ENABLE ROW LEVEL SECURITY;

-- builder_members table
CREATE TABLE public.builder_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.builders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(builder_id, user_id)
);

ALTER TABLE public.builder_members ENABLE ROW LEVEL SECURITY;

-- builder_societies table
CREATE TABLE public.builder_societies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.builders(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(builder_id, society_id)
);

ALTER TABLE public.builder_societies ENABLE ROW LEVEL SECURITY;

-- Add builder_id to societies
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS builder_id uuid REFERENCES public.builders(id);

-- Security definer for builder membership
CREATE OR REPLACE FUNCTION public.is_builder_member(_user_id uuid, _builder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_members
    WHERE user_id = _user_id AND builder_id = _builder_id
  ) OR public.is_admin(_user_id)
$$;

-- Update can_manage_society to include builder members
CREATE OR REPLACE FUNCTION public.can_manage_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_society_admin(_user_id, _society_id)
  OR EXISTS (
    SELECT 1 FROM public.builder_societies bs
    JOIN public.builder_members bm ON bm.builder_id = bs.builder_id
    WHERE bs.society_id = _society_id AND bm.user_id = _user_id
  )
$$;

-- RLS for builders
CREATE POLICY "Builders visible to their members and admins"
ON public.builders FOR SELECT
USING (
  is_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM builder_members bm WHERE bm.builder_id = builders.id AND bm.user_id = auth.uid())
);

CREATE POLICY "Only platform admins can manage builders"
ON public.builders FOR ALL
USING (is_admin(auth.uid()));

-- RLS for builder_members
CREATE POLICY "Builder members visible to same builder"
ON public.builder_members FOR SELECT
USING (
  is_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM builder_members bm2 WHERE bm2.builder_id = builder_members.builder_id AND bm2.user_id = auth.uid())
);

CREATE POLICY "Only platform admins can manage builder members"
ON public.builder_members FOR ALL
USING (is_admin(auth.uid()));

-- RLS for builder_societies
CREATE POLICY "Builder societies visible to builder members"
ON public.builder_societies FOR SELECT
USING (
  is_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM builder_members bm WHERE bm.builder_id = builder_societies.builder_id AND bm.user_id = auth.uid())
);

CREATE POLICY "Only platform admins can manage builder societies"
ON public.builder_societies FOR ALL
USING (is_admin(auth.uid()));
