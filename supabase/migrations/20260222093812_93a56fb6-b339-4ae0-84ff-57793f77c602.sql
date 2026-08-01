
-- Gap #11: Official notices table (distinct from bulletin)
CREATE TABLE public.society_notices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  posted_by UUID NOT NULL REFERENCES public.profiles(id),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  attachment_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.society_notices ENABLE ROW LEVEL SECURITY;

-- Anyone in the society can read notices
CREATE POLICY "Society members can view notices"
  ON public.society_notices FOR SELECT
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_builder_for_society(auth.uid(), society_id));

-- Only admins/builders can create notices
CREATE POLICY "Admins can create notices"
  ON public.society_notices FOR INSERT
  WITH CHECK (public.can_write_to_society(auth.uid(), society_id));

CREATE POLICY "Admins can update notices"
  ON public.society_notices FOR UPDATE
  USING (public.can_write_to_society(auth.uid(), society_id));

CREATE POLICY "Admins can delete notices"
  ON public.society_notices FOR DELETE
  USING (public.can_write_to_society(auth.uid(), society_id));

-- Trigger to notify all residents when a notice is posted
CREATE OR REPLACE FUNCTION public.fn_notify_society_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _resident RECORD;
BEGIN
  FOR _resident IN
    SELECT id FROM profiles WHERE society_id = NEW.society_id AND verification_status = 'approved' AND id != NEW.posted_by
  LOOP
    INSERT INTO notification_queue (user_id, title, body, type, reference_path)
    VALUES (_resident.id, '📢 ' || NEW.title, LEFT(NEW.body, 120), 'notice', '/society/notices');
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_society_notice
  AFTER INSERT ON public.society_notices
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_society_notice();
