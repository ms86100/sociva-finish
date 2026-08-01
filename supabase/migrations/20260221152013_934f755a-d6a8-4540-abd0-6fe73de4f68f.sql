
-- Add lead_time_hours and accepts_preorders to products for per-product seller config
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS lead_time_hours integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepts_preorders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preorder_cutoff_time time DEFAULT NULL;

-- Allow sellers (not just admins) to manage subcategories for their own categories
-- Add a society_id to subcategories so sellers within a society can manage them
-- Actually, subcategories should be global (admin-managed) taxonomy. Sellers just pick them.
-- The current RLS is fine: admins manage, everyone reads.

-- Add RLS policy for sellers to manage subcategories within their society's categories
-- Actually let's keep it simple: society admins + platform admins can manage subcategories.
-- Current policy is sufficient. Sellers select from existing subcategories.
