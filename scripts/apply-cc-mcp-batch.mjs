/**
 * Read .tmp_cc_mcp_calls/{start}-{end}.json and print one JSON line per chunk
 * for agent-side apply_migration (name + query length only to save tokens).
 */
import fs from 'fs';
import path from 'path';

const start = Number(process.argv[2] ?? 7);
const end = Number(process.argv[3] ?? 18);
const dir = path.resolve('.tmp_cc_mcp_calls');
for (let i = start; i <= end; i++) {
  const nn = String(i).padStart(2, '0');
  const fp = path.join(dir, `${nn}.json`);
  if (!fs.existsSync(fp)) {
    console.log(JSON.stringify({ nn, missing: true }));
    continue;
  }
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  console.log(JSON.stringify({ nn, name: j.name, queryLen: j.query.length, file: fp }));
}
