CREATE OR REPLACE FUNCTION public.fn_create_support_ticket(
  p_order_id uuid,
  p_issue_type text,
  p_issue_subtype text,
  p_description text,
  p_evidence_urls text[]
)
RETURNS support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_order RECORD;
  v_seller_user_id uuid;
  v_society_id uuid;
  v_ticket public.support_tickets;
  v_sla_deadline timestamptz := now() + interval '2 hours';
  v_seed_message text;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, buyer_id, seller_id, society_id
    INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.buyer_id <> v_buyer_id THEN
    RAISE EXCEPTION 'not_order_owner' USING ERRCODE = 'P0001';
  END IF;

  SELECT sp.user_id INTO v_seller_user_id
  FROM public.seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_seller_user_id) THEN
    INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
    VALUES (
      'support_ticket_failed',
      v_buyer_id,
      'order',
      p_order_id,
      jsonb_build_object('reason', 'seller_resolution_failed', 'order_seller_id', v_order.seller_id, 'issue_type', p_issue_type)
    );
    RAISE EXCEPTION 'seller_resolution_failed: order % has no resolvable seller', p_order_id USING ERRCODE = 'P0001';
  END IF;

  v_society_id := v_order.society_id;

  -- Neutral, urgency-based seed messages — no hardcoded SLA promises.
  v_seed_message := CASE
    WHEN p_issue_type = 'late_delivery' AND p_issue_subtype = 'still_waiting' THEN
      'Buyer reports the order is overdue and they are still waiting. Please update them as soon as possible.'
    WHEN p_issue_type = 'late_delivery' AND p_issue_subtype = 'no_update' THEN
      'Buyer has not received any status update. Please confirm current status.'
    WHEN p_issue_type = 'late_delivery' THEN
      'Buyer reports a delay. Please review and respond.'
    WHEN p_issue_type = 'missing_item' THEN
      'Buyer reports a missing item. Please review and respond.'
    WHEN p_issue_type = 'wrong_item' THEN
      'Buyer reports a wrong item delivered. Please review and respond.'
    ELSE
      'Support ticket created: ' || replace(p_issue_type, '_', ' ') || '.'
  END || CASE WHEN COALESCE(p_description, '') <> '' THEN ' Buyer note: ' || p_description ELSE '' END;

  INSERT INTO public.support_tickets (
    order_id, buyer_id, seller_id, society_id, issue_type, issue_subtype,
    description, evidence_urls, status, sla_deadline
  ) VALUES (
    p_order_id, v_buyer_id, v_seller_user_id, v_society_id, p_issue_type, p_issue_subtype,
    p_description, COALESCE(p_evidence_urls, ARRAY[]::text[]), 'seller_pending', v_sla_deadline
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.support_ticket_messages (ticket_id, sender_id, sender_type, message_text)
  VALUES (v_ticket.id, v_buyer_id, 'system', v_seed_message);

  -- Seller-aware notification with valid deep link to the order + ticket.
  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user_id,
    'New support ticket',
    'A customer reported: ' || replace(p_issue_type, '_', ' '),
    'support_ticket',
    '/orders/' || p_order_id::text || '?ticket=' || v_ticket.id::text,
    jsonb_build_object(
      'target_role', 'seller',
      'status', 'seller_pending',
      'action', 'View Ticket',
      'ticket_id', v_ticket.id,
      'order_id', p_order_id,
      'issue_type', p_issue_type,
      'sla_deadline', v_sla_deadline,
      'priority', 'high'
    )
  );

  INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
  VALUES (
    'support_ticket_created', v_buyer_id, 'support_ticket', v_ticket.id,
    jsonb_build_object('order_id', p_order_id, 'issue_type', p_issue_type, 'issue_subtype', p_issue_subtype, 'seller_user_id', v_seller_user_id)
  );

  RETURN v_ticket;
END;
$function$;