-- Add placeholder_hint column to parent_groups for seller onboarding CMS
ALTER TABLE public.parent_groups ADD COLUMN IF NOT EXISTS placeholder_hint text;

-- Seed default placeholder hints for existing groups
UPDATE public.parent_groups SET placeholder_hint = 'e.g., Amma''s Kitchen, Fresh Bakes' WHERE slug = 'food' AND placeholder_hint IS NULL;
UPDATE public.parent_groups SET placeholder_hint = 'e.g., QuickFix Repairs, Yoga with Priya' WHERE slug = 'services' AND placeholder_hint IS NULL;
UPDATE public.parent_groups SET placeholder_hint = 'e.g., Style Corner, TechMart' WHERE slug = 'shopping' AND placeholder_hint IS NULL;