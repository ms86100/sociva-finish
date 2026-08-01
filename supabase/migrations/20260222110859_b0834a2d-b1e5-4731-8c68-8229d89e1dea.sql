
-- Drop and recreate the trigger to update the function
DROP TRIGGER IF EXISTS trg_notify_visitor_checked_in ON public.visitor_entries;

CREATE TRIGGER trg_notify_visitor_checked_in
  BEFORE UPDATE ON public.visitor_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_visitor_checked_in();
