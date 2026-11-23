#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/parse-agent-sql.cjs <agent-tools-file>');
  process.exit(1);
}
const raw = fs.readFileSync(input, 'utf8');
const j = JSON.parse(raw);
const text = typeof j.result === 'string' ? j.result : JSON.stringify(j);
const close = text.lastIndexOf('</untrusted-data-');
const openEnd = text.lastIndexOf('>', close);
const openStart = text.lastIndexOf('<untrusted-data-', openEnd);
if (openStart < 0 || close < 0) {
  console.error('No untrusted-data block');
  process.exit(1);
}
const after = text.indexOf('>', openStart) + 1;
const json = text.slice(after, close).trim();
const arr = JSON.parse(json);
const outDir = path.join(__dirname, 'staging-migs');
fs.mkdirSync(outDir, { recursive: true });
for (const row of arr) {
  const file = path.join(outDir, `${row.version}.sql`);
  fs.writeFileSync(file, row.sql || '');
  console.log(row.version, row.name || '', (row.sql || '').length, '->', file);
}
