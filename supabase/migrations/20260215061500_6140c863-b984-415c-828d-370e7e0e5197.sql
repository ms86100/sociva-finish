-- Phase 3: Add preparation time to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS prep_time_minutes integer DEFAULT NULL;