/** Apply one chunk via apply_migration payload file. Usage: node apply-one-cc-chunk.mjs 02 */
import fs from 'fs';
import path from 'path';

const nn = process.argv[2]?.padStart(2, '0');
const applyPath = path.resolve('.tmp_cc_sql', `${nn}_apply.json`);
if (!fs.existsSync(applyPath)) {
  console.error('Missing', applyPath);
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(applyPath, 'utf8'));
// stdout: name only (query applied by caller via MCP reading this file)
console.log(JSON.stringify({ project_id: payload.project_id, name: payload.name, queryLen: payload.query.length }));
