
-- Phase 2: Financial Transparency Engine

-- Table: society_expenses
CREATE TABLE public.society_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  category text NOT NULL DEFAULT 'miscellaneous',
  title text NOT NULL,
  amount numeric NOT NULL,
  vendor_name text,
  invoice_url text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  added_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.society_expenses ENABLE ROW LEVEL SECURITY;

-- Society members can view; admins can insert/update/delete
CREATE POLICY "Society members can view expenses"
  ON public.society_expenses FOR SELECT
  USING (
    society_id = get_user_society_id(auth.uid())
    OR is_admin(auth.uid())
  );

CREATE POLICY "Admins can insert expenses"
  ON public.society_expenses FOR INSERT
  WITH CHECK (
    added_by = auth.uid()
    AND society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can update expenses"
  ON public.society_expenses FOR UPDATE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can delete expenses"
  ON public.society_expenses FOR DELETE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

-- Table: society_income
CREATE TABLE public.society_income (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  source text NOT NULL DEFAULT 'maintenance',
  amount numeric NOT NULL,
  description text,
  income_date date NOT NULL DEFAULT CURRENT_DATE,
  added_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.society_income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view income"
  ON public.society_income FOR SELECT
  USING (
    society_id = get_user_society_id(auth.uid())
    OR is_admin(auth.uid())
  );

CREATE POLICY "Admins can insert income"
  ON public.society_income FOR INSERT
  WITH CHECK (
    added_by = auth.uid()
    AND society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can update income"
  ON public.society_income FOR UPDATE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can delete income"
  ON public.society_income FOR DELETE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

-- Table: expense_flags
CREATE TABLE public.expense_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES public.society_expenses(id) ON DELETE CASCADE,
  flagged_by uuid NOT NULL REFERENCES public.profiles(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_flags ENABLE ROW LEVEL SECURITY;

-- Flagger + admins can view
CREATE POLICY "Flaggers and admins can view flags"
  ON public.expense_flags FOR SELECT
  USING (
    flagged_by = auth.uid()
    OR is_admin(auth.uid())
  );

-- Any society member can flag
CREATE POLICY "Society members can flag expenses"
  ON public.expense_flags FOR INSERT
  WITH CHECK (
    flagged_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.society_expenses se
      WHERE se.id = expense_flags.expense_id
      AND se.society_id = get_user_society_id(auth.uid())
    )
  );

-- Admins can update flags (respond/resolve)
CREATE POLICY "Admins can update flags"
  ON public.expense_flags FOR UPDATE
  USING (is_admin(auth.uid()));
