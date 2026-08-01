
-- =============================================
-- GAP #2: Wire notification triggers for key events
-- Creates DB triggers that auto-insert into notification_queue
-- when visitors check in, parcels arrive, disputes change, snags update, milestones post
-- =============================================

-- 1. Visitor check-in notification → notify resident
CREATE OR REPLACE FUNCTION public.notify_visitor_checked_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _resident_name text;
BEGIN
  -- Only fire when status changes to checked_in
  IF NEW.status = 'checked_in' AND (OLD.status IS DISTINCT FROM 'checked_in') THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.resident_id,
      '🚪 Visitor Arrived',
      NEW.visitor_name || ' has checked in at the gate.',
      'visitor',
      '/visitors',
      jsonb_build_object('visitorId', NEW.id, 'visitorName', NEW.visitor_name)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_visitor_checked_in
  AFTER UPDATE ON public.visitor_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_visitor_checked_in();

-- 2. Parcel received notification → notify resident
CREATE OR REPLACE FUNCTION public.notify_parcel_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.resident_id,
    '📦 Parcel Received',
    'A ' || COALESCE(NEW.courier_name, 'package') || ' has arrived for you. Please collect from the gate.',
    'parcel',
    '/parcels',
    jsonb_build_object('parcelId', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_parcel_received
  AFTER INSERT ON public.parcel_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_parcel_received();

-- 3. Dispute status change notification → notify submitter
CREATE OR REPLACE FUNCTION public.notify_dispute_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _title text;
  _body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'acknowledged' THEN
      _title := '👁️ Dispute Acknowledged';
      _body := 'Your dispute has been acknowledged by the committee.';
    WHEN 'in_progress' THEN
      _title := '🔧 Dispute In Progress';
      _body := 'Your dispute is being actively worked on.';
    WHEN 'resolved' THEN
      _title := '✅ Dispute Resolved';
      _body := 'Your dispute has been resolved. ' || COALESCE('Resolution: ' || NEW.resolution_note, '');
    WHEN 'closed' THEN
      _title := '🔒 Dispute Closed';
      _body := 'Your dispute has been closed.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.submitted_by,
    _title,
    _body,
    'dispute',
    '/disputes',
    jsonb_build_object('disputeId', NEW.id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_dispute_status_change
  AFTER UPDATE ON public.dispute_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dispute_status_change();

-- 4. Snag status change notification → notify reporter
CREATE OR REPLACE FUNCTION public.notify_snag_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _title text;
  _body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'acknowledged' THEN
      _title := '👁️ Snag Acknowledged';
      _body := 'Your snag report "' || LEFT(NEW.title, 40) || '" has been acknowledged.';
    WHEN 'in_progress' THEN
      _title := '🔧 Snag Being Fixed';
      _body := 'Work has started on "' || LEFT(NEW.title, 40) || '".';
    WHEN 'fixed' THEN
      _title := '✅ Snag Fixed';
      _body := '"' || LEFT(NEW.title, 40) || '" has been marked as fixed. Please verify.';
    WHEN 'verified' THEN
      _title := '🎉 Snag Verified';
      _body := '"' || LEFT(NEW.title, 40) || '" fix has been verified and closed.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.reported_by,
    _title,
    _body,
    'snag',
    '/society/snags',
    jsonb_build_object('snagId', NEW.id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_snag_status_change
  AFTER UPDATE ON public.snag_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_snag_status_change();

-- 5. Construction milestone posted → notify all society residents
CREATE OR REPLACE FUNCTION public.notify_milestone_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _resident record;
BEGIN
  -- Notify all approved residents of this society (except the poster)
  FOR _resident IN
    SELECT id FROM profiles
    WHERE society_id = NEW.society_id
      AND verification_status = 'approved'
      AND id != NEW.posted_by
    LIMIT 500
  LOOP
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _resident.id,
      '🏗️ Construction Update',
      NEW.title || ' - ' || NEW.completion_percentage || '% complete',
      'milestone',
      '/society/progress',
      jsonb_build_object('milestoneId', NEW.id, 'stage', NEW.stage)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_milestone_posted
  AFTER INSERT ON public.construction_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_milestone_posted();

-- 6. New dispute submitted → notify society admins
CREATE OR REPLACE FUNCTION public.notify_new_dispute_to_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _admin record;
  _submitter_name text;
BEGIN
  SELECT name INTO _submitter_name FROM profiles WHERE id = NEW.submitted_by;

  FOR _admin IN
    SELECT user_id FROM society_admins
    WHERE society_id = NEW.society_id
      AND user_id != NEW.submitted_by
  LOOP
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin.user_id,
      '⚠️ New Dispute Raised',
      COALESCE(_submitter_name, 'A resident') || ' raised a ' || NEW.category || ' dispute.',
      'dispute',
      '/disputes',
      jsonb_build_object('disputeId', NEW.id, 'category', NEW.category)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_dispute_to_admins
  AFTER INSERT ON public.dispute_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_dispute_to_admins();

-- 7. New snag reported → notify society admins + builder members
CREATE OR REPLACE FUNCTION public.notify_new_snag_to_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _admin record;
  _reporter_name text;
BEGIN
  SELECT name INTO _reporter_name FROM profiles WHERE id = NEW.reported_by;

  -- Notify society admins
  FOR _admin IN
    SELECT user_id FROM society_admins
    WHERE society_id = NEW.society_id
      AND user_id != NEW.reported_by
  LOOP
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin.user_id,
      '🐛 New Snag Report',
      COALESCE(_reporter_name, 'A resident') || ' reported: ' || LEFT(NEW.title, 50),
      'snag',
      '/society/snags',
      jsonb_build_object('snagId', NEW.id, 'category', NEW.category)
    );
  END LOOP;

  -- Notify builder members for this society
  FOR _admin IN
    SELECT bm.user_id
    FROM builder_members bm
    JOIN builder_societies bs ON bs.builder_id = bm.builder_id
    WHERE bs.society_id = NEW.society_id
      AND bm.deactivated_at IS NULL
      AND bm.user_id != NEW.reported_by
  LOOP
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin.user_id,
      '🐛 New Snag Report',
      COALESCE(_reporter_name, 'A resident') || ' reported: ' || LEFT(NEW.title, 50),
      'snag',
      '/builder',
      jsonb_build_object('snagId', NEW.id, 'category', NEW.category, 'societyId', NEW.society_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_snag_to_admins
  AFTER INSERT ON public.snag_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_snag_to_admins();
