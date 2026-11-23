/**
 * Apply all .tmp_cc_sql/*_apply.json via Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN (same as tmp-deploy-via-mcp.mjs).
 */
import fs from 'fs';
import path from 'path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectId = 'kkzkuyhgdvyecmxtmkpy';
const dir = path.resolve('.tmp_cc_sql');
const logPath = path.resolve('.tmp_cc_apply_results.jsonl');

if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN');
  process.exit(2);
}

const applyFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('_apply.json'))
  .sort();

const results = [];
for (const f of applyFiles) {
  const nn = f.slice(0, 2);
  const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const url = `https://api.supabase.com/v1/projects/${projectId}/database/migrations`;
  const body = { name: payload.name, query: payload.query };
  let status = 'ok';
  let detail = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      status = 'fail';
      detail = `${res.status} ${text.slice(0, 800)}`;
    } else {
      detail = text.slice(0, 200);
    }
  } catch (e) {
    status = 'fail';
    detail = String(e);
  }
  const row = { nn, name: payload.name, status, detail };
  results.push(row);
  fs.appendFileSync(logPath, JSON.stringify(row) + '\n');
  console.log(nn, payload.name, status, detail.slice(0, 120));
}

console.log('done', results.filter((r) => r.status === 'ok').length, '/', results.length);
