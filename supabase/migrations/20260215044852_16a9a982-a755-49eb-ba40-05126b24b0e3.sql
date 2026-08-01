
-- 1. Add 'draft' to verification_status enum for seller draft support
ALTER TYPE public.verification_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'pending';

-- 2. Update auto_approve_resident trigger to always auto-approve signups
CREATE OR REPLACE FUNCTION public.auto_approve_resident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Always auto-approve new residents (email verification still required by auth)
  NEW.verification_status := 'approved';
  RETURN NEW;
END;
$$;
