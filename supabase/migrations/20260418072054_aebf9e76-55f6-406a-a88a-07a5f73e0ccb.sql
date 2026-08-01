-- Sync trigger to mirror payload<->data and reference_path<->action_url
CREATE OR REPLACE FUNCTION public.sync_notification_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Mirror payload <-> data
  IF NEW.payload IS NOT NULL AND NEW.payload <> '{}'::jsonb
     AND (NEW.data IS NULL OR NEW.data = '{}'::jsonb) THEN
    NEW.data := NEW.payload;
  ELSIF NEW.data IS NOT NULL AND NEW.data <> '{}'::jsonb
     AND (NEW.payload IS NULL OR NEW.payload = '{}'::jsonb) THEN
    NEW.payload := NEW.data;
  END IF;

  -- Mirror reference_path <-> action_url
  IF NEW.reference_path IS NOT NULL AND NEW.action_url IS NULL THEN
    NEW.action_url := NEW.reference_path;
  ELSIF NEW.action_url IS NOT NULL AND NEW.reference_path IS NULL THEN
    NEW.reference_path := NEW.action_url;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notification_columns ON public.user_notifications;
CREATE TRIGGER trg_sync_notification_columns
  BEFORE INSERT OR UPDATE ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_notification_columns();

-- One-time backfill for existing rows
UPDATE public.user_notifications
SET data = COALESCE(NULLIF(data, '{}'::jsonb), payload),
    action_url = COALESCE(action_url, reference_path)
WHERE ((data IS NULL OR data = '{}'::jsonb) AND payload IS NOT NULL AND payload <> '{}'::jsonb)
   OR (action_url IS NULL AND reference_path IS NOT NULL);