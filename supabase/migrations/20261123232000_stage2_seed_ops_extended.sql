-- Stage 2 extended seed: help, conversations, marketplace synthetic order+dispute,
-- Society B notice, service provider identity. Staging only. Idempotent.

DO $$
DECLARE
  sid_a uuid := 'a1111111-0001-4000-8000-00000000000a';
  sid_b uuid := 'a1111111-0002-4000-8000-00000000000b';
  u_admin_b uuid := 'a2222222-0010-4000-8000-000000000010';
  u_res_a1 uuid := 'a2222222-0006-4000-8000-000000000006';
  u_res_a2 uuid := 'a2222222-0007-4000-8000-000000000007';
  u_seller_a uuid := 'a2222222-0008-4000-8000-000000000008';
  u_svc uuid := 'a2222222-0014-4000-8000-000000000014';
  order_id uuid := 'a3333333-0010-4000-8000-000000000010';
  product_id uuid := 'a3333333-0009-4000-8000-000000000009';
  conv_id uuid := 'a3333333-0011-4000-8000-000000000011';
  help_id uuid := 'a3333333-0012-4000-8000-000000000012';
  dispute_id uuid := 'a3333333-0008-4000-8000-000000000008';
  notice_b uuid := 'a3333333-0013-4000-8000-000000000013';
  seller_profile_id uuid := 'a3333333-0015-4000-8000-000000000015';
  msg_id uuid := 'a3333333-0014-4000-8000-000000000014';
  pwd text := 'SocivaStage2!2026';
BEGIN
  PERFORM public.stage2_ensure_auth_user(
    u_svc,
    'service.a@stage2.sociva.test',
    '+919900000014',
    pwd,
    'Stage2 Service Provider A'
  );

  INSERT INTO public.profiles (
    id, name, phone, email, society_id, flat_number, block,
    verification_status, phone_verified, has_seen_onboarding
  ) VALUES (
    u_svc, 'Stage2 Service Provider A', '+919900000014', 'service.a@stage2.sociva.test',
    sid_a, 'A-SVC', 'A', 'approved', true, true
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    society_id = EXCLUDED.society_id,
    verification_status = 'approved',
    phone_verified = true,
    updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (u_svc, 'buyer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.society_memberships (user_id, society_id, status, invite_verified, requested_at, decided_at)
  VALUES (u_svc, sid_a, 'active', true, now(), now())
  ON CONFLICT (user_id, society_id) DO UPDATE SET status = 'active', invite_verified = true, updated_at = now();

  INSERT INTO public.help_requests (
    id, society_id, requester_id, title, category, urgency, status, tag
  ) VALUES (
    help_id, sid_a, u_res_a1,
    'Stage2 help - corridor light',
    'maintenance', 'normal', 'open', 'general'
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = 'open';

  INSERT INTO public.conversations (
    id, society_id, kind, status, created_by
  ) VALUES (
    conv_id, sid_a, 'direct', 'active', u_res_a1
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES
    (conv_id, u_res_a1, 'member'),
    (conv_id, u_res_a2, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  INSERT INTO public.conversation_messages (id, conversation_id, sender_id, body)
  VALUES (
    msg_id, conv_id, u_res_a1, 'Stage2 synthetic hello - corridor light out near A201.'
  )
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body;

  INSERT INTO public.seller_profiles (
    id, user_id, business_name, categories, verification_status, society_id, is_available,
    latitude, longitude, delivery_radius_km, service_radius_km, accepts_cod
  ) VALUES (
    seller_profile_id,
    u_seller_a,
    'Stage2 Corner Store',
    ARRAY['groceries']::product_category[],
    'approved',
    sid_a,
    true,
    12.9716, 77.5946, 5, 5, true
  )
  ON CONFLICT (id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    verification_status = 'approved',
    society_id = EXCLUDED.society_id,
    is_available = true,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    delivery_radius_km = EXCLUDED.delivery_radius_km,
    service_radius_km = EXCLUDED.service_radius_km;

  -- Onboarding Sociva credit: exactly 500 (workspace rule)
  INSERT INTO public.seller_credit_accounts (
    seller_id, available, reserved, lifetime_purchased, lifetime_consumed, lifetime_adjusted, last_health
  ) VALUES (
    seller_profile_id, 500, 0, 500, 0, 0, 'healthy'
  )
  ON CONFLICT (seller_id) DO UPDATE SET
    available = GREATEST(public.seller_credit_accounts.available, 500),
    last_health = 'healthy',
    updated_at = now();

  INSERT INTO public.products (
    id, seller_id, name, price, category, approval_status, action_type
  ) VALUES (
    product_id, seller_profile_id, 'Stage2 Test Bundle', 199, 'groceries', 'approved', 'add_to_cart'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    approval_status = 'approved';

  INSERT INTO public.orders (
    id, buyer_id, seller_id, society_id, buyer_society_id, seller_society_id,
    status, total_amount, payment_type, payment_status, fulfillment_type, notes, subtotal
  ) VALUES (
    order_id, u_res_a1, seller_profile_id, sid_a, sid_a, sid_a,
    'placed', 199, 'cod', 'pending', 'self_pickup',
    'Stage2 synthetic order - payment pending (not a completed gateway txn)', 199
  )
  ON CONFLICT (id) DO UPDATE SET
    payment_status = 'pending',
    notes = EXCLUDED.notes,
    total_amount = 199;

  INSERT INTO public.dispute_tickets (
    id, order_id, raised_by, category, reason, status, priority, is_anonymous
  ) VALUES (
    dispute_id, order_id, u_res_a1, 'quality',
    'Stage2 Order Dispute - synthetic for admin resolution',
    'open', 'medium', false
  )
  ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason, status = 'open';

  INSERT INTO public.society_notices (
    id, society_id, title, body, category, is_pinned, posted_by, is_active
  ) VALUES (
    notice_b, sid_b,
    'Stage2 B-Only Notice',
    'Synthetic B notice - Society A residents must not read this via RLS.',
    'general', false, u_admin_b, true
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, is_active = true;
END;
$$;
