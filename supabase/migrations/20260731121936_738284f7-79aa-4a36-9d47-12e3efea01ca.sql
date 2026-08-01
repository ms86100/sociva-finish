CREATE OR REPLACE FUNCTION public.validate_security_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.security_mode IS NULL THEN
    NEW.security_mode := 'basic';
  END IF;

  IF NEW.security_mode NOT IN ('basic', 'confirmation', 'ai_match') THEN
    RAISE EXCEPTION 'Invalid security_mode: %. Must be basic, confirmation, or ai_match', NEW.security_mode;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_security_mode_trigger ON public.societies;
CREATE TRIGGER validate_security_mode_trigger
  BEFORE INSERT OR UPDATE OF security_mode ON public.societies
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_security_mode();