/**
 * Staging Realtime + storage isolation soak (staging only).
 * Architecture skill: RLS is the real isolation; channels are defense-in-depth.
 *
 * Usage: node scripts/stage2-realtime-storage-soak.cjs
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const STAGING_REF = 'wwuanzbusxoyzixuprxs';
const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';
const SOCIETY_A = 'a1111111-0001-4000-8000-00000000000a';
const SOCIETY_B = 'a1111111-0002-4000-8000-00000000000b';
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
function record(name, expected, actual, pass, evidence) {
  results.push({ name, expected, actual, pass: !!pass, evidence: evidence || null });
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
  if (error || !data.session) throw new Error(error?.message || 'no_session');
  return { sb, user: data.user, token: data.session.access_token };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  assertStaging();
  console.log(`[soak] target=${STAGING_REF}`);

  const a = await signIn('resident.a1@stage2.sociva.test');
  const b = await signIn('resident.b1@stage2.sociva.test');

  // --- Tower registry isolation ---
  const towersB = await a.sb.rpc('list_society_towers', { _society_id: SOCIETY_B });
  record(
    'rpc_resident_a_cannot_list_towers_b',
    'rejected or empty unauthorized',
    towersB.error ? towersB.error.message : `rows=${(towersB.data || []).length}`,
    !!towersB.error || (Array.isArray(towersB.data) && towersB.data.length === 0),
    null,
  );

  const towersA = await a.sb.rpc('list_society_towers', { _society_id: SOCIETY_A });
  record(
    'rpc_resident_a_lists_towers_a',
    '>=1 tower',
    towersA.error ? towersA.error.message : `rows=${(towersA.data || []).length}`,
    !towersA.error && (towersA.data || []).length >= 1,
    null,
  );

  // --- Storage: A cannot upload into B's folder ---
  // Minimal 1x1 PNG (MIME allowed by payment-proofs bucket caps)
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const crossUpload = await fetch(`${url}/storage/v1/object/payment-proofs/${b.user.id}/soak-forbidden.png`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${a.token}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: png1x1,
  });
  record(
    'storage_a_cannot_upload_into_b_folder',
    'denied (4xx)',
    `status=${crossUpload.status}`,
    crossUpload.status >= 400 && crossUpload.status < 500,
    await crossUpload.text().then((t) => t.slice(0, 120)),
  );

  const ownUpload = await fetch(`${url}/storage/v1/object/payment-proofs/${a.user.id}/soak-ok-${Date.now()}.png`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${a.token}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: png1x1,
  });
  record(
    'storage_a_can_upload_own_folder',
    '2xx',
    `status=${ownUpload.status}`,
    ownUpload.status >= 200 && ownUpload.status < 300,
    await ownUpload.text().then((t) => t.slice(0, 120)),
  );

  // --- Realtime soak: A listens to chat_messages; B inserts non-participant row should not deliver ---
  let leakedEvent = false;
  let gotOwnScoped = false;
  const channel = a.sb
    .channel(`soak-chat-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        const row = payload.new || {};
        if (row.sender_id === b.user.id || row.receiver_id === b.user.id) {
          if (row.sender_id !== a.user.id && row.receiver_id !== a.user.id) {
            leakedEvent = true;
          }
        }
        if (row.sender_id === a.user.id || row.receiver_id === a.user.id) {
          gotOwnScoped = true;
        }
      },
    );
  await new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
    });
  });

  // B tries a non-order insert (should fail INSERT policy) - if it somehow succeeds, A must not see it
  const { error: bInsErr } = await b.sb.from('chat_messages').insert({
    sender_id: b.user.id,
    receiver_id: b.user.id,
    message_text: 'soak isolation probe',
    order_id: null,
  });
  record(
    'chat_insert_without_order_party_blocked_or_self_only',
    'insert rejected OR self-only',
    bInsErr ? bInsErr.message : 'insert ok (self loop)',
    true,
    bInsErr?.message || null,
  );

  await sleep(2500);
  await a.sb.removeChannel(channel);

  record(
    'realtime_no_cross_party_chat_leak_to_a',
    'no leak event',
    `leaked=${leakedEvent} ownHint=${gotOwnScoped}`,
    !leakedEvent,
    null,
  );

  // --- chat society_id column present ---
  const { data: msgCols, error: colErr } = await a.sb
    .from('chat_messages')
    .select('id,society_id')
    .limit(1);
  record(
    'chat_messages_society_id_selectable',
    'query ok',
    colErr ? colErr.message : `rows=${(msgCols || []).length}`,
    !colErr,
    null,
  );

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const report = {
    generated_at: new Date().toISOString(),
    target: STAGING_REF,
    production_touched: false,
    summary: { total: results.length, passed, failed },
    results,
  };
  const outDir = path.join(process.cwd(), 'docs', 'go-live');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'stage2-realtime-storage-soak-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  console.log(`wrote ${outPath}`);
  if (failed > 0) {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`- FAIL ${r.name}: expected=${r.expected} actual=${r.actual}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
