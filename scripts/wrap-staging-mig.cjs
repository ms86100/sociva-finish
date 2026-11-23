#!/usr/bin/env node
'use strict';
const fs = require('fs');
const version = process.argv[2];
const name = process.argv[3];
if (!version || !name) {
  console.error('Usage: node scripts/wrap-staging-mig.cjs <version> <name>');
  process.exit(1);
}
const sqlPath = `scripts/staging-migs/${version}.sql`;
const sql = fs.readFileSync(sqlPath, 'utf8');
const wrapped =
  sql +
  `\n\nINSERT INTO supabase_migrations.schema_migrations (version, name, statements)\n` +
  `VALUES ('${version}', '${name}', ARRAY['${name}']::text[])\n` +
  `ON CONFLICT (version) DO NOTHING;\n`;
const out = `scripts/staging-migs/${version}.wrapped.sql`;
fs.writeFileSync(out, wrapped);
console.log(out, wrapped.length);
