-- Stage 2 staging seed (idempotent). Synthetic data only.
-- Marker: stage2_seed / emails *@stage2.sociva.test / phones +91990000xxxx
-- Does not delete existing non-seed rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.stage2_ensure_auth_user(
  _id uuid,
  _email text,
  _phone text,
  _password text,
  _full_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'auth', 'extensions', 'public'
AS $$
DECLARE
  v_instance uuid;
BEGIN
  SELECT id INTO v_instance FROM auth.instances LIMIT 1;
  IF v_instance IS NULL THEN
    v_instance := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    v_instance,
    _id,
    'authenticated',
    'authenticated',
    _email,
    crypt(_password, gen_salt('bf')),
    now(),
    _phone,
    now(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('full_name', _full_name, 'stage2_seed', true),
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
    phone_confirmed_at = COALESCE(auth.users.phone_confirmed_at, now()),
    raw_user_meta_data = COALESCE(auth.users.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', _full_name, 'stage2_seed', true),
    updated_at = now();

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    _id,
    _id,
    jsonb_build_object('sub', _id::text, 'email', _email, 'email_verified', true, 'phone', _phone),
    'email',
    _id::text,
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider, provider_id) DO UPDATE SET
    identity_data = EXCLUDED.identity_data,
    updated_at = now();

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.stage2_ensure_auth_user(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  -- Societies
  sid_a uuid := 'a1111111-0001-4000-8000-00000000000a';
  sid_b uuid := 'a1111111-0002-4000-8000-00000000000b';
  sid_c uuid := 'a1111111-0003-4000-8000-00000000000c';
  builder_id uuid := 'a1111111-00bb-4000-8000-0000000000bb';
  pilot_pkg uuid;

  -- Users (deterministic)
  u_platform uuid := 'a2222222-0001-4000-8000-000000000001';
  u_admin_a uuid := 'a2222222-0002-4000-8000-000000000002';
  u_mod_a uuid := 'a2222222-0003-4000-8000-000000000003';
  u_guard_a uuid := 'a2222222-0004-4000-8000-000000000004';
  u_guard_sup_a uuid := 'a2222222-0005-4000-8000-000000000005';
  u_res_a1 uuid := 'a2222222-0006-4000-8000-000000000006';
  u_res_a2 uuid := 'a2222222-0007-4000-8000-000000000007';
  u_seller_a uuid := 'a2222222-0008-4000-8000-000000000008';
  u_admin_b uuid := 'a2222222-0010-4000-8000-000000000010';
  u_guard_b uuid := 'a2222222-0011-4000-8000-000000000011';
  u_res_b1 uuid := 'a2222222-0012-4000-8000-000000000012';
  u_res_c1 uuid := 'a2222222-0013-4000-8000-000000000013';

  pwd text := 'SocivaStage2!2026';
  today date := CURRENT_DATE;
BEGIN
  -- Builder
  INSERT INTO public.builders (id, name, slug, description, is_active, contact_email)
  VALUES (
    builder_id,
    'Sociva Staging Pilot Builder',
    'sociva-staging-pilot-builder',
    'Stage2 synthetic builder for pilot package assignment',
    true,
    'builder-pilot@stage2.sociva.test'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = true,
    updated_at = now();

  SELECT id INTO pilot_pkg
  FROM public.feature_packages
  WHERE package_name = 'sociva_pilot_ops' OR name = 'Sociva Pilot Ops'
  LIMIT 1;

  IF pilot_pkg IS NULL THEN
    RAISE EXCEPTION 'sociva_pilot_ops package missing - apply stage2_features_rpc_pilot_package first';
  END IF;

  INSERT INTO public.builder_feature_packages (builder_id, package_id, assigned_at)
  VALUES (builder_id, pilot_pkg, now())
  ON CONFLICT (builder_id, package_id) DO NOTHING;

  -- Societies A (rich), B (isolated), C (minimal)
  INSERT INTO public.societies (
    id, name, slug, invite_code, is_active, is_verified, security_mode,
    auto_approve_residents, approval_method, address, latitude, longitude
  ) VALUES
    (sid_a, 'Sociva Test Residency A', 'sociva-test-residency-a', 'STAGE2A', true, true, 'basic', false, 'manual',
     'Stage2 Tower A, Synthetic Colony', 12.971600, 77.594600),
    (sid_b, 'Sociva Test Residency B', 'sociva-test-residency-b', 'STAGE2B', true, true, 'confirmation', false, 'manual',
     'Stage2 Tower B, Synthetic Colony', 12.980000, 77.600000),
    (sid_c, 'Sociva Test Residency C', 'sociva-test-residency-c', 'STAGE2C', true, true, 'basic', true, 'invite_code',
     'Stage2 Tower C, Synthetic Colony', 12.990000, 77.610000)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    invite_code = EXCLUDED.invite_code,
    is_active = true,
    is_verified = true,
    security_mode = EXCLUDED.security_mode,
    auto_approve_residents = EXCLUDED.auto_approve_residents,
    approval_method = EXCLUDED.approval_method,
    updated_at = now();

  -- Link A + B to pilot builder (C stays default-only for empty-state testing of ops modules)
  INSERT INTO public.builder_societies (builder_id, society_id)
  VALUES (builder_id, sid_a), (builder_id, sid_b)
  ON CONFLICT (builder_id, society_id) DO NOTHING;

  -- Auth users
  PERFORM public.stage2_ensure_auth_user(u_platform, 'platform.admin@stage2.sociva.test', '+919900000001', pwd, 'Stage2 Platform Admin');
  PERFORM public.stage2_ensure_auth_user(u_admin_a, 'admin.a@stage2.sociva.test', '+919900000002', pwd, 'Stage2 Admin A');
  PERFORM public.stage2_ensure_auth_user(u_mod_a, 'mod.a@stage2.sociva.test', '+919900000003', pwd, 'Stage2 Moderator A');
  PERFORM public.stage2_ensure_auth_user(u_guard_a, 'guard.a@stage2.sociva.test', '+919900000004', pwd, 'Stage2 Guard A');
  PERFORM public.stage2_ensure_auth_user(u_guard_sup_a, 'guard.sup.a@stage2.sociva.test', '+919900000005', pwd, 'Stage2 Guard Supervisor A');
  PERFORM public.stage2_ensure_auth_user(u_res_a1, 'resident.a1@stage2.sociva.test', '+919900000006', pwd, 'Stage2 Resident A1');
  PERFORM public.stage2_ensure_auth_user(u_res_a2, 'resident.a2@stage2.sociva.test', '+919900000007', pwd, 'Stage2 Resident A2');
  PERFORM public.stage2_ensure_auth_user(u_seller_a, 'seller.a@stage2.sociva.test', '+919900000008', pwd, 'Stage2 Seller A');
  PERFORM public.stage2_ensure_auth_user(u_admin_b, 'admin.b@stage2.sociva.test', '+919900000010', pwd, 'Stage2 Admin B');
  PERFORM public.stage2_ensure_auth_user(u_guard_b, 'guard.b@stage2.sociva.test', '+919900000011', pwd, 'Stage2 Guard B');
  PERFORM public.stage2_ensure_auth_user(u_res_b1, 'resident.b1@stage2.sociva.test', '+919900000012', pwd, 'Stage2 Resident B1');
  PERFORM public.stage2_ensure_auth_user(u_res_c1, 'resident.c1@stage2.sociva.test', '+919900000013', pwd, 'Stage2 Resident C1');

  -- Profiles (service_role bypasses privileged guard)
  INSERT INTO public.profiles (
    id, name, phone, email, society_id, flat_number, block, phase,
    verification_status, phone_verified, has_seen_onboarding
  ) VALUES
    (u_platform, 'Stage2 Platform Admin', '+919900000001', 'platform.admin@stage2.sociva.test', sid_a, 'P1', 'HQ', '1', 'approved', true, true),
    (u_admin_a, 'Stage2 Admin A', '+919900000002', 'admin.a@stage2.sociva.test', sid_a, 'A101', 'A', '1', 'approved', true, true),
    (u_mod_a, 'Stage2 Moderator A', '+919900000003', 'mod.a@stage2.sociva.test', sid_a, 'A102', 'A', '1', 'approved', true, true),
    (u_guard_a, 'Stage2 Guard A', '+919900000004', 'guard.a@stage2.sociva.test', sid_a, 'GATE', 'G', '1', 'approved', true, true),
    (u_guard_sup_a, 'Stage2 Guard Supervisor A', '+919900000005', 'guard.sup.a@stage2.sociva.test', sid_a, 'GATE', 'G', '1', 'approved', true, true),
    (u_res_a1, 'Stage2 Resident A1', '+919900000006', 'resident.a1@stage2.sociva.test', sid_a, 'A201', 'A', '1', 'approved', true, true),
    (u_res_a2, 'Stage2 Resident A2', '+919900000007', 'resident.a2@stage2.sociva.test', sid_a, 'A202', 'A', '1', 'approved', true, true),
    (u_seller_a, 'Stage2 Seller A', '+919900000008', 'seller.a@stage2.sociva.test', sid_a, 'A301', 'A', '1', 'approved', true, true),
    (u_admin_b, 'Stage2 Admin B', '+919900000010', 'admin.b@stage2.sociva.test', sid_b, 'B101', 'B', '1', 'approved', true, true),
    (u_guard_b, 'Stage2 Guard B', '+919900000011', 'guard.b@stage2.sociva.test', sid_b, 'GATE', 'G', '1', 'approved', true, true),
    (u_res_b1, 'Stage2 Resident B1', '+919900000012', 'resident.b1@stage2.sociva.test', sid_b, 'B201', 'B', '1', 'approved', true, true),
    (u_res_c1, 'Stage2 Resident C1', '+919900000013', 'resident.c1@stage2.sociva.test', sid_c, 'C101', 'C', '1', 'approved', true, true)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    society_id = EXCLUDED.society_id,
    flat_number = EXCLUDED.flat_number,
    block = EXCLUDED.block,
    verification_status = 'approved',
    phone_verified = true,
    has_seen_onboarding = true,
    updated_at = now();

  -- Platform admin role
  INSERT INTO public.user_roles (user_id, role)
  VALUES
    (u_platform, 'admin'),
    (u_res_a1, 'buyer'), (u_res_a2, 'buyer'), (u_res_b1, 'buyer'), (u_res_c1, 'buyer'),
    (u_seller_a, 'seller'), (u_seller_a, 'buyer')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Memberships active
  INSERT INTO public.society_memberships (user_id, society_id, status, invite_verified, requested_at, decided_at)
  SELECT x.user_id, x.society_id, 'active', true, now(), now()
  FROM (VALUES
    (u_platform, sid_a), (u_admin_a, sid_a), (u_mod_a, sid_a), (u_guard_a, sid_a), (u_guard_sup_a, sid_a),
    (u_res_a1, sid_a), (u_res_a2, sid_a), (u_seller_a, sid_a),
    (u_admin_b, sid_b), (u_guard_b, sid_b), (u_res_b1, sid_b),
    (u_res_c1, sid_c)
  ) AS x(user_id, society_id)
  ON CONFLICT (user_id, society_id) DO UPDATE SET
    status = 'active',
    invite_verified = true,
    decided_at = COALESCE(public.society_memberships.decided_at, now()),
    updated_at = now();

  -- Backfill memberships if unique constraint is (user_id, society_id)
  UPDATE public.society_memberships m
  SET status = 'active', invite_verified = true, decided_at = COALESCE(m.decided_at, now()), updated_at = now()
  WHERE m.user_id IN (u_platform, u_admin_a, u_mod_a, u_guard_a, u_guard_sup_a, u_res_a1, u_res_a2, u_seller_a, u_admin_b, u_guard_b, u_res_b1, u_res_c1)
    AND m.status IS DISTINCT FROM 'active';

  -- Society admins / moderators
  INSERT INTO public.society_admins (society_id, user_id, role, appointed_by)
  VALUES
    (sid_a, u_admin_a, 'admin', u_platform),
    (sid_a, u_mod_a, 'moderator', u_admin_a),
    (sid_b, u_admin_b, 'admin', u_platform)
  ON CONFLICT (society_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    deactivated_at = NULL;

  -- Security staff
  INSERT INTO public.security_staff (society_id, user_id, role, shift, gate_assignment, phone, is_active)
  VALUES
    (sid_a, u_guard_a, 'guard', 'day', 'Main Gate', '+919900000004', true),
    (sid_a, u_guard_sup_a, 'supervisor', 'day', 'Main Gate', '+919900000005', true),
    (sid_b, u_guard_b, 'guard', 'day', 'Main Gate', '+919900000011', true)
  ON CONFLICT (society_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    deactivated_at = NULL;

  -- Authorized persons (A)
  INSERT INTO public.authorized_persons (id, society_id, resident_id, person_name, relationship, phone, flat_number, is_active)
  VALUES (
    'a3333333-0001-4000-8000-000000000001',
    sid_a, u_res_a1, 'Stage2 Family Guest', 'Family', '+919900000101', 'A201', true
  )
  ON CONFLICT (id) DO UPDATE SET is_active = true, person_name = EXCLUDED.person_name;

  -- Visitors (A) - OTP for guard testing
  INSERT INTO public.visitor_entries (
    id, society_id, resident_id, visitor_name, visitor_phone, visitor_type, purpose,
    expected_date, expected_time, otp_code, otp_expires_at, is_preapproved, is_recurring,
    status, flat_number, vehicle_number
  ) VALUES (
    'a3333333-0002-4000-8000-000000000002',
    sid_a, u_res_a1, 'Stage2 Expected Guest', '+919900000201', 'guest', 'Family visit',
    today, '18:00', '246801', now() + interval '12 hours', true, false,
    'expected', 'A201', 'KA01ST2001'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'expected',
    otp_code = '246801',
    otp_expires_at = now() + interval '12 hours',
    expected_date = today;

  -- Isolation visitor on B (must not be readable by A)
  INSERT INTO public.visitor_entries (
    id, society_id, resident_id, visitor_name, visitor_phone, visitor_type, purpose,
    expected_date, otp_code, otp_expires_at, is_preapproved, status, flat_number
  ) VALUES (
    'a3333333-0002-4000-8000-0000000000b2',
    sid_b, u_res_b1, 'Stage2 B-Only Guest', '+919900000212', 'guest', 'Private visit',
    today, '135790', now() + interval '12 hours', true, 'expected', 'B201'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'expected', otp_code = '135790', otp_expires_at = now() + interval '12 hours';

  -- Parcels A
  INSERT INTO public.parcel_entries (
    id, society_id, resident_id, flat_number, courier_name, tracking_number, description,
    status, received_at, logged_by
  ) VALUES (
    'a3333333-0003-4000-8000-000000000003',
    sid_a, u_res_a1, 'A201', 'Stage2 Courier', 'ST2TRACK001', 'Synthetic parcel awaiting pickup',
    'received', now() - interval '2 hours', u_guard_a
  )
  ON CONFLICT (id) DO UPDATE SET status = 'received', description = EXCLUDED.description;

  -- Parking A
  INSERT INTO public.parking_slots (
    id, society_id, slot_number, slot_type, is_assigned, is_occupied, vehicle_number, vehicle_type, assigned_to
  ) VALUES (
    'a3333333-0004-4000-8000-000000000004',
    sid_a, 'A-P01', 'car', true, true, 'KA01ST1001', 'car', u_res_a1
  )
  ON CONFLICT (id) DO UPDATE SET is_occupied = true, vehicle_number = EXCLUDED.vehicle_number;

  -- Notices A
  INSERT INTO public.society_notices (
    id, society_id, title, body, category, is_pinned, posted_by, is_active
  ) VALUES (
    'a3333333-0005-4000-8000-000000000005',
    sid_a,
    'Stage2 Water Maintenance Notice',
    'Synthetic notice for Stage2 validation. Water tank cleaning on Sunday 10 AM to 1 PM.',
    'maintenance',
    true,
    u_admin_a,
    true
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, is_active = true;

  -- Bulletin A
  INSERT INTO public.bulletin_posts (
    id, society_id, author_id, type, title, body, category, visibility, is_pinned, is_archived
  ) VALUES (
    'a3333333-0006-4000-8000-000000000006',
    sid_a, u_res_a1, 'general', 'Stage2 Community Hello',
    'Synthetic bulletin post for Stage2 Smart Groups / community validation.',
    'general', 'society', false, false
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, is_archived = false;

  -- Maintenance dues A (pending - no fabricated paid gateway txn)
  INSERT INTO public.maintenance_dues (
    id, society_id, resident_id, flat_identifier, month, month_year, amount, late_fee, payment_status, due_date, unit_number, block
  ) VALUES (
    'a3333333-0007-4000-8000-000000000007',
    sid_a, u_res_a1, 'A-A201', to_char(today, 'YYYY-MM'), to_char(today, 'YYYY-MM'), 2500, 0, 'pending', today + 7, 'A201', 'A'
  )
  ON CONFLICT (id) DO UPDATE SET payment_status = 'pending', amount = 2500;

  -- Dispute seed requires order_id (NOT NULL). Created in stage2_seed_ops_extended.

END;
$$;

-- Cleanup helper for seed-owned rows only (manual invoke; not auto-run)
CREATE OR REPLACE FUNCTION public.stage2_cleanup_seed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  deleted_visitors int := 0;
  deleted_parcels int := 0;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'stage2_cleanup_seed restricted' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.visitor_entries WHERE id::text LIKE 'a3333333-%';
  GET DIAGNOSTICS deleted_visitors = ROW_COUNT;
  DELETE FROM public.parcel_entries WHERE id::text LIKE 'a3333333-%';
  GET DIAGNOSTICS deleted_parcels = ROW_COUNT;
  DELETE FROM public.parking_slots WHERE id::text LIKE 'a3333333-%';
  DELETE FROM public.society_notices WHERE id::text LIKE 'a3333333-%';
  DELETE FROM public.bulletin_posts WHERE id::text LIKE 'a3333333-%';
  DELETE FROM public.maintenance_dues WHERE id::text LIKE 'a3333333-%';
  DELETE FROM public.authorized_persons WHERE id::text LIKE 'a3333333-%';

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_visitors', deleted_visitors,
    'deleted_parcels', deleted_parcels,
    'note', 'Auth users and societies retained for reuse; call again after deleting roles if full wipe needed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage2_cleanup_seed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage2_cleanup_seed() TO service_role;
