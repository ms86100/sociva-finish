
-- Phase 2.4: Validate preferred_language against supported_languages at DB level
CREATE OR REPLACE FUNCTION public.validate_worker_preferred_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.preferred_language IS NOT NULL AND NEW.preferred_language != '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supported_languages
      WHERE code = NEW.preferred_language AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Invalid preferred_language: %. Not found in supported_languages or not active.', NEW.preferred_language;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_worker_preferred_language
BEFORE INSERT OR UPDATE ON public.society_workers
FOR EACH ROW
EXECUTE FUNCTION public.validate_worker_preferred_language();
