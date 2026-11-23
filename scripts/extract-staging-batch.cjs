#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const input = process.argv[2];
const raw = fs.readFileSync(input, 'utf8');
const j = JSON.parse(raw);
const text = typeof j.result === 'string' ? j.result : JSON.stringify(j);
const close = text.lastIndexOf('</untrusted-data-');
const openStart = text.lastIndexOf('<untrusted-data-', close);
const after = text.indexOf('>', openStart) + 1;
const outer = JSON.parse(text.slice(after, close).trim());
let batch = outer;
if (Array.isArray(outer) && outer[0] && outer[0].batch != null) {
  batch = typeof outer[0].batch === 'string' ? JSON.parse(outer[0].batch) : outer[0].batch;
}
const outDir = path.join(__dirname, 'staging-migs');
fs.mkdirSync(outDir, { recursive: true });
for (const row of batch) {
  const sql = row.sql || '';
  fs.writeFileSync(path.join(outDir, `${row.version}.sql`), sql);
  const wrapped =
    sql +
    `\n\nINSERT INTO supabase_migrations.schema_migrations (version, name, statements)\n` +
    `VALUES ('${row.version}', '${row.name}', ARRAY['${row.name}']::text[])\n` +
    `ON CONFLICT (version) DO NOTHING;\n`;
  fs.writeFileSync(path.join(outDir, `${row.version}.wrapped.sql`), wrapped);
  console.log(row.version, row.name, sql.length);
}
