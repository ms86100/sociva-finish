
-- Add normalized_name to societies
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS normalized_name text;

-- Create society_aliases table
CREATE TABLE IF NOT EXISTS public.society_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  normalized_alias text NOT NULL,
  google_place_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_aliases_trgm ON public.society_aliases USING gin (normalized_alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_aliases_society ON public.society_aliases(society_id);
CREATE INDEX IF NOT EXISTS idx_societies_norm_trgm ON public.societies USING gin (normalized_name gin_trgm_ops);

ALTER TABLE public.society_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read aliases" ON public.society_aliases FOR SELECT USING (true);

-- Backfill normalized_name for existing societies
UPDATE public.societies SET normalized_name = trim(regexp_replace(
  lower(regexp_replace(name, '\s*(phase|ph|tower|block|wing|sec|sector)\s*[\d\-IiVvXx]*', '', 'gi')),
  '\s+', ' ', 'g'))
WHERE normalized_name IS NULL;
