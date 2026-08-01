
-- Add location and address columns to builders table
ALTER TABLE public.builders
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric;
