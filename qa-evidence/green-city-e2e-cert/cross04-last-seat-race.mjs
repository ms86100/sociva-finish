/**
 * CROSS04 last-seat race against prod Sociva (two guests, seats_available=1).
 * Usage: node qa-evidence/green-city-e2e-cert/cross04-last-seat-race.mjs
 */
const URL = 'https://kkzkuyhgdvyecmxtmkpy.supabase.co';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA';
const PUB = '76d6fd7e-1f75-4567-8403-c801b565b923';
const PASS = 'CertGuest2026!';

async function login(email) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function requestSeat(token, note) {
  const started = Date.now();
  const res = await fetch(`${URL}/rest/v1/rpc/cleaner_city_request_ride`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      p_publication_id: PUB,
      p_note: note,
      p_guest_pickup_lat: 13.072,
      p_guest_pickup_lng: 77.752,
      p_guest_dest_lat: 12.972,
      p_guest_dest_lng: 77.595,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, ms: Date.now() - started, body: json };
}

async function main() {
  const [t1, t2] = await Promise.all([
    login('cert-guest-gc@test.sociva.com'),
    login('cert-guest2-gc@test.sociva.com'),
  ]);
  const wallStart = Date.now();
  const [r1, r2] = await Promise.all([
    requestSeat(t1, 'CROSS04-g1'),
    requestSeat(t2, 'CROSS04-g2'),
  ]);
  const wallMs = Date.now() - wallStart;
  const wins = [r1, r2].filter((r) => r.ok);
  const fails = [r1, r2].filter((r) => !r.ok);
  const failMsg = String(JSON.stringify(fails[0]?.body || '')).toLowerCase();
  // When last seat books, status flips to full before seats check on the loser.
  const pass =
    wins.length === 1 &&
    fails.length === 1 &&
    (failMsg.includes('no seats') ||
      failMsg.includes('publication not open') ||
      failMsg.includes('not open'));

  const out = {
    case_id: 'CROSS04',
    status: pass ? 'PASS' : 'FAIL',
    wall_ms: wallMs,
    wins: wins.length,
    fails: fails.length,
    guest1: r1,
    guest2: r2,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
