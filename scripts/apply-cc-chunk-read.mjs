/** Print {name, query} for one cc chunk (00-18) from .tmp_cc_sql */
import fs from 'fs';
import path from 'path';

const nn = process.argv[2]?.padStart(2, '0');
if (!nn) {
  console.error('Usage: node apply-cc-chunk-read.mjs <00-18>');
  process.exit(1);
}
const dir = path.resolve('.tmp_cc_sql');
const sqlFile = fs.readdirSync(dir).find((f) => f.startsWith(`${nn}_`) && f.endsWith('.sql'));
const metaFile = sqlFile?.replace(/\.sql$/, '.meta.json');
if (!sqlFile || !metaFile) {
  console.error('Missing chunk files for', nn);
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(dir, metaFile), 'utf8'));
const query = fs.readFileSync(path.join(dir, sqlFile), 'utf8');
console.log(JSON.stringify({ name: meta.name, query }));
