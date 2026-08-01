-- Add phase column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS phase TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.phase IS 'Residential phase (e.g., Phase 1, Phase 2)';