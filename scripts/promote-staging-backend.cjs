#!/usr/bin/env node
/**
 * Promote validated staging backend changes to production Supabase.
 *
 * SAFETY:
 * - Never runs without --confirm-production
 * - Does NOT merge the entire Supabase branch (avoids unrelated branch drift)
 * - Applies only the listed migration files from this repo to production
 * - Prints a dry-run plan unless --apply is also passed
 *
 * Usage:
 *   node scripts/promote-staging-backend.cjs
 *   node scripts/promote-staging-backend.cjs --confirm-production --apply
 *
 * After backend promote:
 *   1. Keep ios-release Codemagic workflow on production keys (already default)
 *   2. Ship App Store / production TestFlight from ios-release (NOT ios-testflight-staging)
 *   3. Testers stop using Sociva Staging builds
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';
const STAGING_REF = 'wwuanzbusxoyzixuprxs';
const STAGING_BRANCH_ID = '4bdc2467-55b6-440e-8420-9a0a7388865e';

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = [
  'supabase/migrations/20260922153157_app_installations_permission_lifecycle.sql',
];

const args = new Set(process.argv.slice(2));
const confirm = args.has('--confirm-production');
const apply = args.has('--apply');

console.log(`
╔══════════════════════════════════════════════════════════╗
║  Sociva backend promote: STAGING → PRODUCTION            ║
╠══════════════════════════════════════════════════════════╣
║  Staging project : ${STAGING_REF}
║  Staging branch  : onboarding-integration (${STAGING_BRANCH_ID})
║  Production      : ${PROD_REF}
╚══════════════════════════════════════════════════════════╝
`);

for (const rel of MIGRATIONS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`Missing migration: ${rel}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(abs, 'utf8');
  console.log(`\n-- ${rel} (${sql.length} bytes) --`);
  console.log(sql.split('\n').slice(0, 8).join('\n') + '\n…');
}

if (!confirm) {
  console.log(`
DRY RUN / PLAN ONLY.

To apply these migrations to PRODUCTION Supabase (${PROD_REF}):

  node scripts/promote-staging-backend.cjs --confirm-production --apply

Or via Supabase MCP (Cursor):

  apply_migration
    project_id: ${PROD_REF}
    name: app_installations_permission_lifecycle
    query: <contents of the migration file>

DO NOT use merge_branch blindly - the staging branch may contain
unrelated historical changes. Prefer applying the explicit migration
files listed above.

After apply:
  1. Verify production: SELECT to_regclass('public.app_installations');
  2. Build production iOS with workflow: ios-release
  3. Retire TestFlight staging builds for external users
`);
  process.exit(0);
}

if (!apply) {
  console.log('Confirmed, but --apply was not passed. No changes made.');
  process.exit(0);
}

console.error(`
--apply cannot call Supabase MCP from this Node script in CI without credentials.

Run the apply from Cursor with explicit approval, targeting ONLY:

  project_id = ${PROD_REF}

Never pass staging project_id ${STAGING_REF} when promoting.
`);
process.exit(2);
