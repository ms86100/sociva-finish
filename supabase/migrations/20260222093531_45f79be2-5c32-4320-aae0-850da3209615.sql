
-- =============================================
-- Gap #1: Builder Announcements table
-- =============================================
CREATE TABLE public.builder_announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  builder_id UUID NOT NULL REFERENCES public.builders(id),
  society_id UUID NOT NULL REFERENCES public.societies(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'update',
  posted_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.builder_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder members can create announcements"
  ON public.builder_announcements FOR INSERT
  WITH CHECK (
    is_builder_for_society(auth.uid(), society_id)
  );

CREATE POLICY "Society members can read announcements"
  ON public.builder_announcements FOR SELECT
  USING (
    society_id IN (
      SELECT society_id FROM public.profiles WHERE id = auth.uid() AND society_id IS NOT NULL
    )
    OR is_builder_for_society(auth.uid(), society_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.builder_announcements;

-- =============================================
-- Gap #6: Construction → Payment milestone auto-linking trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.fn_link_construction_to_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_milestones
    SET status = 'due', updated_at = now()
  WHERE society_id = NEW.society_id
    AND milestone_stage = NEW.stage
    AND status = 'upcoming'
    AND (tower_id IS NULL OR tower_id = NEW.tower_id);

  UPDATE public.payment_milestones
    SET linked_milestone_id = NEW.id, updated_at = now()
  WHERE society_id = NEW.society_id
    AND milestone_stage = NEW.stage
    AND linked_milestone_id IS NULL
    AND (tower_id IS NULL OR tower_id = NEW.tower_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_link_construction_to_payment
  AFTER INSERT ON public.construction_milestones
  FOR EACH ROW EXECUTE FUNCTION public.fn_link_construction_to_payment();

-- =============================================
-- Gap #9: Domestic help → auto-create visitor entry trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.fn_create_domestic_help_visitor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.visitor_entries (
    society_id, resident_id, visitor_name, visitor_phone,
    visitor_type, purpose, flat_number,
    is_preapproved, is_recurring, status
  ) VALUES (
    NEW.society_id, NEW.resident_id, NEW.help_name, NEW.help_phone,
    'domestic_help', NEW.help_type, NEW.flat_number,
    true, true, 'expected'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_domestic_help_visitor_entry
  AFTER INSERT ON public.domestic_help_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_create_domestic_help_visitor();

-- Notify builder announcements to all society members
CREATE OR REPLACE FUNCTION public.fn_notify_builder_announcement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id UUID;
BEGIN
  FOR _user_id IN
    SELECT id FROM public.profiles
    WHERE society_id = NEW.society_id AND id != NEW.posted_by
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path)
    VALUES (_user_id, '📢 ' || NEW.title, LEFT(NEW.body, 200), 'builder_update', '/society/progress');
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_builder_announcement
  AFTER INSERT ON public.builder_announcements
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_builder_announcement();
