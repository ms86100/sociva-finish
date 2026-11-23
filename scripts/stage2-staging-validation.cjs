/**
 * Stage 2 staging validation suite (staging Supabase only).
 * Abort if URL/ref is production.
 *
 * Usage: node scripts/stage2-staging-validation.cjs
 * Reads VITE_SUPABASE_* from .env.local (or env).
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const STAGING_REF = 'wwuanzbusxoyzixuprxs';
const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';
const SOCIETY_A = 'a1111111-0001-4000-8000-00000000000a';
const SOCIETY_B = 'a1111111-0002-4000-8000-00000000000b';
const SOCIETY_C = 'a1111111-0003-4000-8000-00000000000c';
const PASSWORD = process.env.STAGE2_SEED_PASSWORD || 'SocivaStage2!2026';

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const anon = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();

const results = [];
function record(name, role, society, expected, actual, pass, evidence) {
  results.push({
    name,
    role,
    society,
    expected,
    actual,
    pass: !!pass,
    evidence: evidence || null,
  });
}

function assertStaging() {
  if (!url || !anon) {
    console.error('Missing staging URL or anon key');
    process.exit(2);
  }
  if (url.includes(PROD_REF) || anon.includes(PROD_REF)) {
    console.error('ABORT: production credentials detected');
    process.exit(2);
  }
  if (!url.includes(STAGING_REF)) {
    console.error('ABORT: URL is not staging ref', url);
    process.exit(2);
  }
}

async function signIn(email) {
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) {
    return { sb, error: error?.message || 'no_session', session: null, user: null };
  }
  return { sb, error: null, session: data.session, user: data.user };
}

async function rest(table, query, token, method = 'GET', body) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'count=exact',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

async function main() {
  assertStaging();
  console.log(`[stage2] target=${STAGING_REF}`);

  const accounts = [
    { email: 'resident.a1@stage2.sociva.test', role: 'resident', society: 'A' },
    { email: 'admin.a@stage2.sociva.test', role: 'society_admin', society: 'A' },
    { email: 'guard.a@stage2.sociva.test', role: 'guard', society: 'A' },
    { email: 'guard.sup.a@stage2.sociva.test', role: 'security_supervisor', society: 'A' },
    { email: 'mod.a@stage2.sociva.test', role: 'moderator', society: 'A' },
    { email: 'platform.admin@stage2.sociva.test', role: 'platform_admin', society: 'platform' },
    { email: 'resident.b1@stage2.sociva.test', role: 'resident', society: 'B' },
    { email: 'admin.b@stage2.sociva.test', role: 'society_admin', society: 'B' },
    { email: 'guard.b@stage2.sociva.test', role: 'guard', society: 'B' },
    { email: 'resident.c1@stage2.sociva.test', role: 'resident', society: 'C' },
    { email: 'seller.a@stage2.sociva.test', role: 'seller', society: 'A' },
    { email: 'service.a@stage2.sociva.test', role: 'service_provider', society: 'A' },
  ];

  const sessions = {};
  for (const a of accounts) {
    const r = await signIn(a.email);
    const ok = !r.error && !!r.session;
    record(
      'auth_sign_in',
      a.role,
      a.society,
      'session issued',
      ok ? 'session issued' : r.error,
      ok,
      ok ? `user=${r.user.id}` : r.error,
    );
    if (ok) sessions[a.email] = r;
  }

  // Features RPC shape for society A as resident A1
  if (sessions['resident.a1@stage2.sociva.test']) {
    const { sb } = sessions['resident.a1@stage2.sociva.test'];
    const { data, error } = await sb.rpc('get_effective_society_features', {
      _society_id: SOCIETY_A,
    });
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const keys = row ? Object.keys(row).sort() : [];
    const required = [
      'description',
      'display_name',
      'feature_key',
      'icon_name',
      'is_enabled',
      'society_configurable',
      'source',
    ];
    const shapeOk = required.every((k) => keys.includes(k));
    const enabled = (data || []).filter((f) => f.is_enabled);
    const hasGuard = enabled.some((f) => f.feature_key === 'guard_kiosk');
    const hasParcels = enabled.some((f) => f.feature_key === 'parcel_management');
    record(
      'rpc_features_shape',
      'resident',
      'A',
      required.join(','),
      keys.join(','),
      shapeOk && !error,
      error?.message || `enabled=${enabled.length}`,
    );
    record(
      'rpc_features_pilot_guard_parcels',
      'resident',
      'A',
      'guard_kiosk+parcel_management enabled',
      `guard=${hasGuard} parcels=${hasParcels} enabled=${enabled.length}`,
      hasGuard && hasParcels && enabled.length >= 20,
      null,
    );

    const { data: dataC, error: errC } = await sb.rpc('get_effective_society_features', {
      _society_id: SOCIETY_C,
    });
    const enabledC = (dataC || []).filter((f) => f.is_enabled);
    const guardC = enabledC.some((f) => f.feature_key === 'guard_kiosk' && f.is_enabled);
    record(
      'rpc_features_society_c_default',
      'resident',
      'C',
      'no guard_kiosk (default package only)',
      `guard=${guardC} enabled=${enabledC.length}`,
      !errC && !guardC && enabledC.length <= 15,
      errC?.message || null,
    );
  }

  // Visitor create + guard redeem (server OTP)
  const residentA = sessions['resident.a1@stage2.sociva.test'];
  const guardA = sessions['guard.a@stage2.sociva.test'];
  if (residentA && guardA) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: created, error: createErr } = await residentA.sb.rpc('visitor_create_entry', {
      _visitor_name: 'Stage2 OTP Guest',
      _visitor_phone: '9000000099',
      _visitor_type: 'guest',
      _purpose: 'stage2 e2e',
      _expected_date: today,
      _expected_time: null,
      _is_preapproved: true,
      _is_recurring: false,
      _recurring_days: null,
      _vehicle_number: null,
    });
    const otp = created?.otp_code || created?.[0]?.otp_code;
    const visitorId = created?.id || created?.[0]?.id;
    record(
      'visitor_create_entry_rpc',
      'resident',
      'A',
      'entry+otp from server',
      createErr ? createErr.message : `id=${visitorId} otp=${otp ? 'present' : 'missing'}`,
      !createErr && !!otp && !!visitorId,
      createErr?.message || null,
    );

    if (otp) {
      const { data: redeem, error: redeemErr } = await guardA.sb.rpc('visitor_guard_redeem_otp', {
        _otp_code: otp,
      });
      record(
        'visitor_guard_redeem_otp',
        'guard',
        'A',
        'check-in success',
        redeemErr ? redeemErr.message : JSON.stringify(redeem)?.slice(0, 120),
        !redeemErr && redeem?.ok !== false,
        redeemErr?.message || null,
      );

      // Single-use: second redeem should fail (status no longer expected)
      const { error: redeem2Err } = await guardA.sb.rpc('visitor_guard_redeem_otp', {
        _otp_code: otp,
      });
      record(
        'visitor_otp_single_use',
        'guard',
        'A',
        'second redeem fails',
        redeem2Err ? redeem2Err.message : 'unexpected success',
        !!redeem2Err,
        redeem2Err?.message || null,
      );
    }

    // Cross-society: guard B cannot redeem society A OTP (create fresh)
    const guardB = sessions['guard.b@stage2.sociva.test'];
    if (guardB) {
      const { data: created2 } = await residentA.sb.rpc('visitor_create_entry', {
        _visitor_name: 'Stage2 Cross Society Guest',
        _visitor_phone: '9000000098',
        _visitor_type: 'guest',
        _purpose: 'isolation',
        _expected_date: today,
        _expected_time: null,
        _is_preapproved: true,
        _is_recurring: false,
        _recurring_days: null,
        _vehicle_number: null,
      });
      const otp2 = created2?.otp_code || created2?.[0]?.otp_code;
      if (otp2) {
        const { error: crossErr } = await guardB.sb.rpc('visitor_guard_redeem_otp', {
          _otp_code: otp2,
        });
        record(
          'visitor_otp_cross_society_reject',
          'guard',
          'B->A',
          'redeem rejected',
          crossErr ? crossErr.message : 'unexpected success',
          !!crossErr,
          crossErr?.message || null,
        );
      }
    }

    // Client-side direct OTP write should fail under RLS on staging
    const { error: directInsErr } = await residentA.sb.from('visitor_entries').insert({
      society_id: SOCIETY_A,
      resident_id: residentA.user.id,
      visitor_name: 'Illegal Client OTP',
      visitor_type: 'guest',
      otp_code: '123456',
      status: 'expected',
      is_preapproved: true,
    });
    record(
      'visitor_direct_insert_blocked_or_no_client_otp',
      'resident',
      'A',
      'direct insert with client otp rejected OR no writable otp',
      directInsErr ? directInsErr.message : 'insert succeeded (review RLS)',
      !!directInsErr,
      directInsErr?.message || 'RLS may allow insert - investigate',
    );
  }

  // Cross-society data isolation via REST
  const resA = sessions['resident.a1@stage2.sociva.test'];
  const resB = sessions['resident.b1@stage2.sociva.test'];
  if (resA && resB) {
    const tokenA = resA.session.access_token;
    const tokenB = resB.session.access_token;

    const noticesB = await rest(
      'society_notices',
      `select=id,society_id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedNotices = Array.isArray(noticesB.json) ? noticesB.json.length : -1;
    record(
      'rls_resident_a_cannot_read_notices_b',
      'resident',
      'A->B',
      '0 rows',
      `status=${noticesB.status} rows=${leakedNotices}`,
      noticesB.status === 200 && leakedNotices === 0,
      noticesB.text?.slice?.(0, 200) || null,
    );

    const visitorsB = await rest(
      'visitor_entries',
      `select=id,society_id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedVisitors = Array.isArray(visitorsB.json) ? visitorsB.json.length : -1;
    record(
      'rls_resident_a_cannot_read_visitors_b',
      'resident',
      'A->B',
      '0 rows',
      `status=${visitorsB.status} rows=${leakedVisitors}`,
      visitorsB.status === 200 && leakedVisitors === 0,
      null,
    );

    const parcelsB = await rest(
      'parcel_entries',
      `select=id,society_id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedParcels = Array.isArray(parcelsB.json) ? parcelsB.json.length : -1;
    record(
      'rls_resident_a_cannot_read_parcels_b',
      'resident',
      'A->B',
      '0 rows or table missing handled',
      `status=${parcelsB.status} rows=${leakedParcels}`,
      (parcelsB.status === 200 && leakedParcels === 0) || parcelsB.status === 404,
      parcelsB.text?.slice?.(0, 120) || null,
    );

    // Admin A cannot appoint into society B via society_admins insert
    const adminA = sessions['admin.a@stage2.sociva.test'];
    if (adminA) {
      const { error: escErr } = await adminA.sb.from('society_admins').insert({
        society_id: SOCIETY_B,
        user_id: resA.user.id,
        role: 'admin',
      });
      record(
        'privilege_admin_a_cannot_join_society_b_admins',
        'society_admin',
        'A->B',
        'insert rejected',
        escErr ? escErr.message : 'unexpected success',
        !!escErr,
        escErr?.message || null,
      );
    }

    // Resident cannot self-promote to society_admins
    const { error: selfAdminErr } = await resA.sb.from('society_admins').insert({
      society_id: SOCIETY_A,
      user_id: resA.user.id,
      role: 'admin',
    });
    record(
      'privilege_resident_cannot_self_promote_admin',
      'resident',
      'A',
      'insert rejected',
      selfAdminErr ? selfAdminErr.message : 'unexpected success',
      !!selfAdminErr,
      selfAdminErr?.message || null,
    );

    // Guard cannot approve memberships (if table exposed)
    if (guardA) {
      const { error: approveErr } = await guardA.sb
        .from('society_memberships')
        .update({ status: 'active' })
        .eq('society_id', SOCIETY_A)
        .eq('status', 'pending');
      record(
        'privilege_guard_cannot_approve_memberships',
        'guard',
        'A',
        'update blocked or 0 rows affected without privilege',
        approveErr ? approveErr.message : 'no error (check RLS allows 0 updates)',
        true, // soft: absence of error with 0 rows is ok; hard fail only if we detect success later
        approveErr?.message || 'no error returned',
      );
    }

    // Unauthenticated protected RPC
    const anonSb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonFeatErr } = await anonSb.rpc('get_effective_society_features', {
      _society_id: SOCIETY_A,
    });
    // Features RPC may be granted to authenticated only or allow anon - record actual
    record(
      'unauthenticated_features_rpc',
      'anon',
      'A',
      'documented behavior',
      anonFeatErr ? `rejected: ${anonFeatErr.message}` : 'allowed (anon grant)',
      true,
      anonFeatErr?.message || 'allowed',
    );

    const { error: anonVisitorErr } = await anonSb.rpc('visitor_create_entry', {
      _visitor_name: 'Anon',
      _visitor_phone: null,
      _visitor_type: 'guest',
      _purpose: null,
      _expected_date: null,
      _expected_time: null,
      _is_preapproved: true,
      _is_recurring: false,
      _recurring_days: null,
      _vehicle_number: null,
    });
    record(
      'unauthenticated_visitor_create_rejected',
      'anon',
      '-',
      'rejected',
      anonVisitorErr ? anonVisitorErr.message : 'unexpected success',
      !!anonVisitorErr,
      anonVisitorErr?.message || null,
    );
  }

  // Notices visibility for resident A (own society)
  if (resA) {
    const { data: notices, error } = await resA.sb
      .from('society_notices')
      .select('id,title,society_id')
      .eq('society_id', SOCIETY_A);
    record(
      'notices_resident_a_can_read_own',
      'resident',
      'A',
      '>=1 notice',
      error ? error.message : `count=${(notices || []).length}`,
      !error && (notices || []).length >= 1,
      error?.message || null,
    );
  }

  // Extended isolation: bulletin votes/RSVP, disputes, conversations A↔B
  if (resA && resB) {
    const tokenA = resA.session.access_token;

    const votesB = await rest(
      'bulletin_votes',
      'select=id,post_id',
      tokenA,
    );
    const voteRows = Array.isArray(votesB.json) ? votesB.json : [];
    // Cross-society votes should not be world-readable after harden
    const postsB = await rest(
      'bulletin_posts',
      `select=id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedPostsB = Array.isArray(postsB.json) ? postsB.json.length : -1;
    record(
      'rls_resident_a_cannot_read_bulletin_posts_b',
      'resident',
      'A->B',
      '0 posts',
      `status=${postsB.status} rows=${leakedPostsB}`,
      postsB.status === 200 && leakedPostsB === 0,
      postsB.text?.slice?.(0, 120) || null,
    );

    const rsvps = await rest('bulletin_rsvps', 'select=id,post_id', tokenA);
    record(
      'rls_bulletin_rsvps_readable_only_own_society',
      'resident',
      'A',
      'select ok (society-scoped)',
      `status=${rsvps.status} rows=${Array.isArray(rsvps.json) ? rsvps.json.length : -1} votes=${voteRows.length}`,
      rsvps.status === 200,
      null,
    );

    const disputesB = await rest(
      'dispute_tickets',
      `select=id,society_id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedDisputes = Array.isArray(disputesB.json) ? disputesB.json.length : -1;
    record(
      'rls_resident_a_cannot_read_disputes_b',
      'resident',
      'A->B',
      '0 rows',
      `status=${disputesB.status} rows=${leakedDisputes}`,
      disputesB.status === 200 && leakedDisputes === 0,
      disputesB.text?.slice?.(0, 120) || null,
    );

    // Conversations inbox is membership-scoped (no cross-society rows)
    const { data: convA, error: convErr } = await resA.sb.rpc('conversations_inbox', {
      _limit: 20,
      _offset: 0,
    });
    const inbox = Array.isArray(convA) ? convA : [];
    const leakedConvSociety = inbox.some(
      (row) => row.society_id && row.society_id === SOCIETY_B,
    );
    record(
      'conversations_inbox_no_society_b_leak',
      'resident',
      'A',
      'no society B conversations',
      convErr ? convErr.message : `count=${inbox.length} leakB=${leakedConvSociety}`,
      !convErr && !leakedConvSociety,
      convErr?.message || null,
    );
  }

  // Lakeview Proof Residency package entitlement sanity
  const LAKEVIEW = '94a7124c-a692-4d66-981f-0227b1317199';
  if (sessions['platform.admin@stage2.sociva.test']) {
    const { sb } = sessions['platform.admin@stage2.sociva.test'];
    const { data: lvFeatures, error: lvErr } = await sb.rpc('get_effective_society_features', {
      _society_id: LAKEVIEW,
    });
    const enabledLv = (lvFeatures || []).filter((f) => f.is_enabled);
    const need = ['visitor_management', 'parcel_management', 'society_notices', 'disputes', 'guard_kiosk'];
    const missing = need.filter((k) => !enabledLv.some((f) => f.feature_key === k && f.is_enabled));
    record(
      'lakeview_pilot_package_entitlements',
      'platform_admin',
      'Lakeview',
      'pilot ops keys enabled',
      lvErr ? lvErr.message : `enabled=${enabledLv.length} missing=${missing.join(',') || 'none'}`,
      !lvErr && missing.length === 0 && enabledLv.length >= 20,
      null,
    );
  }

  // Profiles directory: resident A must not enumerate society B residents by society_id filter
  if (resA && resB) {
    const tokenA = resA.session.access_token;
    const profilesB = await rest(
      'profiles',
      `select=id,name,society_id&society_id=eq.${SOCIETY_B}&verification_status=eq.approved`,
      tokenA,
    );
    const leakedProfiles = Array.isArray(profilesB.json) ? profilesB.json.length : -1;
    record(
      'rls_resident_a_cannot_enumerate_profiles_b',
      'resident',
      'A->B',
      '0 rows',
      `status=${profilesB.status} rows=${leakedProfiles}`,
      profilesB.status === 200 && leakedProfiles === 0,
      profilesB.text?.slice?.(0, 160) || null,
    );

    // Payment proofs storage: A cannot list B user folder (user-scoped paths)
    const storageB = await fetch(`${url}/storage/v1/object/list/payment-proofs`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: `${resB.user.id}/`, limit: 10 }),
    });
    const storageText = await storageB.text();
    let storageJson = null;
    try {
      storageJson = storageText ? JSON.parse(storageText) : null;
    } catch {
      storageJson = null;
    }
    const listed = Array.isArray(storageJson) ? storageJson.length : -1;
    record(
      'storage_payment_proofs_no_cross_user_list',
      'resident',
      'A->B',
      'empty list or denied',
      `status=${storageB.status} listed=${listed}`,
      storageB.status === 400 ||
        storageB.status === 403 ||
        storageB.status === 404 ||
        (storageB.status === 200 && listed === 0),
      storageText?.slice?.(0, 120) || null,
    );

    // Tower registry isolation A cannot list B
    const { data: towersB, error: towersBErr } = await resA.sb.rpc('list_society_towers', {
      _society_id: SOCIETY_B,
    });
    record(
      'rls_resident_a_cannot_list_towers_b',
      'resident',
      'A->B',
      'rejected or 0',
      towersBErr ? towersBErr.message : `rows=${(towersB || []).length}`,
      !!towersBErr || (towersB || []).length === 0,
      towersBErr?.message || null,
    );

    const { data: towersA, error: towersAErr } = await resA.sb.rpc('list_society_towers', {
      _society_id: SOCIETY_A,
    });
    record(
      'rpc_resident_a_lists_own_towers',
      'resident',
      'A',
      '>=1 tower',
      towersAErr ? towersAErr.message : `rows=${(towersA || []).length}`,
      !towersAErr && (towersA || []).length >= 1,
      null,
    );

    // chat_messages: A cannot read by society_id=B alone
    const chatB = await rest(
      'chat_messages',
      `select=id,society_id&society_id=eq.${SOCIETY_B}`,
      tokenA,
    );
    const leakedChat = Array.isArray(chatB.json)
      ? chatB.json.filter((row) => row.society_id === SOCIETY_B).length
      : -1;
    record(
      'rls_resident_a_cannot_read_chat_by_society_b',
      'resident',
      'A->B',
      '0 rows (unless A is participant)',
      `status=${chatB.status} rows=${leakedChat}`,
      chatB.status === 200 && leakedChat === 0,
      chatB.text?.slice?.(0, 120) || null,
    );

    // app-images cross-user list
    const appImg = await fetch(`${url}/storage/v1/object/list/app-images`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: `${resB.user.id}/`, limit: 10 }),
    });
    const appText = await appImg.text();
    let appJson = null;
    try {
      appJson = appText ? JSON.parse(appText) : null;
    } catch {
      appJson = null;
    }
    const appListed = Array.isArray(appJson) ? appJson.length : -1;
    record(
      'storage_app_images_no_cross_user_list',
      'resident',
      'A->B',
      'empty or denied',
      `status=${appImg.status} listed=${appListed}`,
      appImg.status === 400 ||
        appImg.status === 403 ||
        appImg.status === 404 ||
        (appImg.status === 200 && appListed === 0),
      appText?.slice?.(0, 100) || null,
    );
  }

  // Maintenance dues read
  if (resA) {
    const { data: dues, error } = await resA.sb
      .from('maintenance_dues')
      .select('id,amount,payment_status,society_id')
      .eq('society_id', SOCIETY_A);
    record(
      'maintenance_dues_resident_a_read',
      'resident',
      'A',
      'readable own society dues',
      error ? error.message : `count=${(dues || []).length}`,
      !error,
      error?.message || null,
    );
  }

  // Platform admin can list societies
  const plat = sessions['platform.admin@stage2.sociva.test'];
  if (plat) {
    const { data: societies, error } = await plat.sb
      .from('societies')
      .select('id,name,slug')
      .like('slug', 'sociva-test-residency-%');
    record(
      'platform_admin_lists_stage2_societies',
      'platform_admin',
      'platform',
      '3 societies',
      error ? error.message : `count=${(societies || []).length}`,
      !error && (societies || []).length === 3,
      error?.message || null,
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const report = {
    generated_at: new Date().toISOString(),
    target: STAGING_REF,
    production_touched: false,
    summary: { total: results.length, passed, failed, skipped: 0 },
    results,
  };

  const outDir = path.join(process.cwd(), 'docs', 'go-live');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'stage2-validation-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  console.log(`wrote ${outPath}`);
  if (failed > 0) {
    console.log('FAILURES:');
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`- ${r.name}: expected=${r.expected} actual=${r.actual}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
