
-- Fix: drop and recreate parcel trigger
DROP TRIGGER IF EXISTS trg_notify_parcel_received ON public.parcel_entries;

CREATE TRIGGER trg_notify_parcel_received
  AFTER INSERT ON public.parcel_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_parcel_received();

-- Add logged_by column to parcel_entries for guard-logged parcels
ALTER TABLE public.parcel_entries
ADD COLUMN IF NOT EXISTS logged_by uuid REFERENCES auth.users(id);
