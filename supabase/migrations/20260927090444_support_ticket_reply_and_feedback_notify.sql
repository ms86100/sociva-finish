-- Ticket replies and status changes notify the other person.
-- A breached SLA also notifies platform admins.
-- In-app feedback notifies platform admins. The 2-hour SLA window is unchanged.

CREATE OR REPLACE FUNCTION public.trg_notify_support_ticket_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_recipient uuid;
  v_title text;
  v_body text;
  v_role text;
BEGIN
  IF NEW.sender_type = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE id = NEW.ticket_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'seller' THEN
    v_recipient := v_ticket.buyer_id;
    v_title := 'Seller replied to your ticket';
    v_role := 'buyer';
  ELSIF NEW.sender_type = 'buyer' THEN
    v_recipient := v_ticket.seller_id;
    v_title := 'Buyer replied on a support ticket';
    v_role := 'seller';
  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  v_body := left(btrim(COALESCE(NEW.message_text, '')), 140);
  IF v_body = '' THEN
    v_body := 'Open the order to read the update.';
  END IF;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    v_recipient,
    v_title,
    v_body,
    'support_ticket',
    '/orders/' || v_ticket.order_id::text || '?ticket=' || v_ticket.id::text,
    jsonb_build_object(
      'ticket_id', v_ticket.id,
      'order_id', v_ticket.order_id,
      'target_role', v_role
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_support_ticket_message ON public.support_ticket_messages;
CREATE TRIGGER trg_notify_support_ticket_message
AFTER INSERT ON public.support_ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_support_ticket_message();

CREATE OR REPLACE FUNCTION public.trg_notify_support_ticket_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.buyer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    v_title := 'Your support ticket was resolved';
    v_body := left(btrim(COALESCE(NEW.resolution_note, 'The seller marked this ticket resolved.')), 140);
  ELSIF OLD.status = 'seller_pending' AND NEW.status = 'open' THEN
    v_title := 'The seller needs more information';
    v_body := left(btrim(COALESCE(NEW.resolution_note, 'Open the ticket and reply.')), 140);
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.buyer_id,
    v_title,
    v_body,
    'support_ticket',
    '/orders/' || NEW.order_id::text || '?ticket=' || NEW.id::text,
    jsonb_build_object(
      'ticket_id', NEW.id,
      'order_id', NEW.order_id,
      'target_role', 'buyer',
      'status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_support_ticket_status ON public.support_tickets;
CREATE TRIGGER trg_notify_support_ticket_status
AFTER UPDATE OF status ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_support_ticket_status();

CREATE OR REPLACE FUNCTION public.fn_check_support_sla()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
  v_path text;
BEGIN
  FOR v_ticket IN
    SELECT id, seller_id, buyer_id, order_id
    FROM public.support_tickets
    WHERE sla_breached = false
      AND status IN ('open', 'seller_pending')
      AND sla_deadline < now()
  LOOP
    UPDATE public.support_tickets
    SET sla_breached = true, updated_at = now()
    WHERE id = v_ticket.id;

    v_path := '/orders/' || v_ticket.order_id::text || '?ticket=' || v_ticket.id::text;

    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_ticket.seller_id,
      'Support ticket overdue',
      'A customer support ticket has passed its response time. Please respond.',
      'support_ticket',
      v_path,
      jsonb_build_object(
        'ticket_id', v_ticket.id,
        'order_id', v_ticket.order_id,
        'priority', 'high',
        'sla_breached', true,
        'target_role', 'seller'
      )
    );

    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    SELECT
      ur.user_id,
      'Support ticket needs an admin',
      'A support ticket passed its response time and still needs a reply.',
      'moderation',
      v_path,
      jsonb_build_object(
        'type', 'support_sla',
        'ticket_id', v_ticket.id,
        'order_id', v_ticket.order_id,
        'target_role', 'admin',
        'sla_breached', true
      )
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
      AND ur.user_id IS DISTINCT FROM v_ticket.seller_id
      AND ur.user_id IS DISTINCT FROM v_ticket.buyer_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_admins_user_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text;
BEGIN
  v_body := 'New app feedback, ' || NEW.rating::text || ' of 5.';
  IF COALESCE(btrim(NEW.message), '') <> '' THEN
    v_body := v_body || ' ' || left(btrim(NEW.message), 80);
  END IF;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT
    ur.user_id,
    'New app feedback',
    v_body,
    'moderation',
    '/admin?tab=feedback',
    jsonb_build_object(
      'type', 'user_feedback',
      'feedback_id', NEW.id,
      'rating', NEW.rating,
      'target_role', 'admin'
    )
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_user_feedback ON public.user_feedback;
CREATE TRIGGER trg_notify_admins_user_feedback
AFTER INSERT ON public.user_feedback
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_admins_user_feedback();
