/**
 * Executable B3 concurrency test against local Postgres.
 * Does not touch production.
 *
 * Usage: node src/test/sql/b3-concurrency-runner.mjs
 * Expects PGPASSWORD, PGHOST, PGPORT, PGUSER, PGDATABASE.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const guest = '11111111-1111-4111-8111-111111111111';
const guest2 = '22222222-2222-4222-8222-222222222222';
const hostA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hostB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const society = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const pubA = 'd1000000-0000-4000-8000-000000000001';
const pubB = 'd1000000-0000-4000-8000-000000000002';
const pubC = 'd1000000-0000-4000-8000-000000000003';
const pubD = 'd1000000-0000-4000-8000-000000000004';
const pubE = 'd1000000-0000-4000-8000-000000000005';

function psql(args, sql) {
  return new Promise((resolve) => {
    const child = spawn('psql', [...args], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.write(sql);
    child.stdin.end();
  });
}

async function file(rel) {
  const sql = readFileSync(path.join(root, rel), 'utf8');
  const result = await psql(['-v', 'ON_ERROR_STOP=1', '-q'], sql);
  if (result.code !== 0) {
    throw new Error(`psql ${rel} failed\n${result.err}\n${result.out}`);
  }
}

async function exec(sql) {
  const result = await psql(['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], sql);
  if (result.code !== 0) {
    throw new Error(`${result.err}\n${result.out}`);
  }
  return result.out.trim();
}

function requestSql(userId, publicationId, delay) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SELECT set_config('b3.delay', '${delay ? '1' : ''}', true);
SELECT id::text FROM public.cleaner_city_request_ride('${publicationId}'::uuid, 'b3', NULL, NULL, NULL, NULL);
COMMIT;
`;
}

async function callRide(userId, publicationId, delay) {
  const started = Date.now();
  const result = await psql(['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], requestSql(userId, publicationId, delay));
  return {
    ok: result.code === 0,
    ms: Date.now() - started,
    out: (result.out || '').trim(),
    err: (result.err || '').trim(),
  };
}

async function reset() {
  await exec(`
    TRUNCATE public.rides, public.commute_publications, public.commute_blocks;
    INSERT INTO public.commute_publications (
      id, host_user_id, society_id, travel_date, direction, status,
      seats_available, seats_total, origin_latitude, origin_longitude,
      destination_latitude, destination_longitude
    ) VALUES
      ('${pubA}', '${hostA}', '${society}', DATE '2026-12-01', 'to_office', 'published', 2, 2, 12.9, 77.6, 12.95, 77.7),
      ('${pubB}', '${hostB}', '${society}', DATE '2026-12-01', 'to_office', 'published', 2, 2, 12.91, 77.61, 12.96, 77.71),
      ('${pubC}', '${hostA}', '${society}', DATE '2026-12-02', 'to_office', 'published', 2, 2, 12.9, 77.6, 12.95, 77.7),
      ('${pubD}', '${hostB}', '${society}', DATE '2026-12-01', 'to_home', 'published', 2, 2, 12.95, 77.7, 12.9, 77.6),
      ('${pubE}', '${hostA}', '${society}', DATE '2026-12-01', 'to_office', 'published', 1, 1, 12.9, 77.6, 12.95, 77.7);
  `);
}

async function activeCount(userId, day, direction) {
  return exec(`
    SELECT count(*)::text
    FROM public.rides r
    JOIN public.commute_publications p ON p.id = r.publication_id
    WHERE r.guest_user_id = '${userId}'
      AND r.travel_date = DATE '${day}'
      AND p.direction = '${direction}'
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started');
  `);
}

const results = [];

function record(name, pass, detail) {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  console.log(detail);
}

async function main() {
  await file('src/test/sql/b3-harness.sql');
  await file('supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql');

  await reset();
  const started = Date.now();
  const [a, b] = await Promise.all([
    callRide(guest, pubA, true),
    callRide(guest, pubB, true),
  ]);
  const countA = await activeCount(guest, '2026-12-01', 'to_office');
  const winners = [a, b].filter((r) => r.ok).length;
  const dup = [a, b].filter((r) => /already have an active ride/i.test(r.err)).length;
  record(
    'A same guest date direction two publications',
    winners === 1 && dup === 1 && countA === '1' && Math.max(a.ms, b.ms) >= 1500,
    JSON.stringify({ a, b, active: countA, elapsed: Date.now() - started }, null, 2),
  );

  await reset();
  const [b1, b2] = await Promise.all([
    callRide(guest, pubA, false),
    callRide(guest, pubC, false),
  ]);
  const c1 = await activeCount(guest, '2026-12-01', 'to_office');
  const c2 = await activeCount(guest, '2026-12-02', 'to_office');
  record(
    'B different dates same direction',
    b1.ok && b2.ok && c1 === '1' && c2 === '1',
    JSON.stringify({ b1, b2, day1: c1, day2: c2 }, null, 2),
  );

  await reset();
  const [cOffice, cHome] = await Promise.all([
    callRide(guest, pubA, false),
    callRide(guest, pubD, false),
  ]);
  const office = await activeCount(guest, '2026-12-01', 'to_office');
  const home = await activeCount(guest, '2026-12-01', 'to_home');
  record(
    'C same date opposite direction',
    cOffice.ok && cHome.ok && office === '1' && home === '1',
    JSON.stringify({ cOffice, cHome, office, home }, null, 2),
  );

  await reset();
  const first = await callRide(guest, pubA, false);
  await exec(`UPDATE public.rides SET status = 'cancelled' WHERE guest_user_id = '${guest}';`);
  const again = await callRide(guest, pubB, false);
  const afterCancel = await activeCount(guest, '2026-12-01', 'to_office');
  record(
    'D rebook after cancel',
    first.ok && again.ok && afterCancel === '1',
    JSON.stringify({ first, again, active: afterCancel }, null, 2),
  );

  await reset();
  const [e1, e2] = await Promise.all([
    callRide(guest, pubE, true),
    callRide(guest2, pubE, true),
  ]);
  const seats = await exec(`SELECT seats_available::text FROM public.commute_publications WHERE id = '${pubE}';`);
  const ridesE = await exec(`SELECT count(*)::text FROM public.rides WHERE publication_id = '${pubE}' AND status = 'requested';`);
  const rejected = [e1, e2].filter((r) => /No seats left|Publication not open/i.test(r.err)).length;
  record(
    'E same publication one seat two guests',
    [e1, e2].filter((r) => r.ok).length === 1 && rejected === 1 && seats === '0' && ridesE === '1',
    JSON.stringify({ e1, e2, seats, ridesE, note: 'Loser sees status full, so the existing guard is Publication not open. Seat check is the next line.' }, null, 2),
  );

  await reset();
  const hold = psql(
    ['-v', 'ON_ERROR_STOP=1', '-q'],
    `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${guest}', true);
SELECT id FROM public.cleaner_city_request_ride('${pubA}'::uuid, 'hold', NULL, NULL, NULL, NULL);
SELECT pg_sleep(2);
ROLLBACK;
`,
  );
  await new Promise((r) => setTimeout(r, 400));
  const afterFail = await callRide(guest, pubB, false);
  await hold;
  const countF = await activeCount(guest, '2026-12-01', 'to_office');
  record(
    'F rollback releases lock and a later request succeeds',
    afterFail.ok && countF === '1',
    JSON.stringify({ afterFail, active: countF }, null, 2),
  );

  await exec(`
    CREATE OR REPLACE FUNCTION public.cleaner_city_lock_guest_booking(p_guest uuid, p_travel_date date, p_direction text)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
  `);
  await reset();
  const [g1, g2] = await Promise.all([
    callRide(guest, pubA, true),
    callRide(guest, pubB, true),
  ]);
  const countG = await activeCount(guest, '2026-12-01', 'to_office');
  record(
    'CONTROL no-op lock reproduces two bookings',
    g1.ok && g2.ok && countG === '2',
    JSON.stringify({ g1, g2, active: countG }, null, 2),
  );
  await file('supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql');

  const failed = results.filter((r) => r.status !== 'PASS');
  console.log(JSON.stringify(results, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
