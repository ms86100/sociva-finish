#!/usr/bin/env node
/**
 * Fail the CI build if Supabase target does not match CAPACITOR_ENV / VITE_APP_ENV.
 *
 * Staging TestFlight must NEVER resolve to production project kkzkuyhgdvyecmxtmkpy.
 * Production App Store builds must NEVER resolve to staging branch wwuanzbusxoyzixuprxs.
 *
 * Usage:
 *   node scripts/assert-supabase-env.cjs
 *   node scripts/assert-supabase-env.cjs --require-staging
 *   node scripts/assert-supabase-env.cjs --require-production
 */
'use strict';

const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';
const STAGING_REF = 'wwuanzbusxoyzixuprxs';

const args = new Set(process.argv.slice(2));
const requireStaging = args.has('--require-staging');
const requireProduction = args.has('--require-production');

const appEnv = String(
  process.env.VITE_APP_ENV || process.env.CAPACITOR_ENV || 'production',
).toLowerCase();
const url = String(process.env.VITE_SUPABASE_URL || '')
  .replace(/^["']|["']$/g, '')
  .trim();
const key = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '')
  .replace(/^["']|["']$/g, '')
  .trim();

function fail(msg) {
  console.error('\n❌ [assert-supabase-env] ' + msg + '\n');
  process.exit(1);
}

if (!url) fail('VITE_SUPABASE_URL is missing');
if (!key) fail('VITE_SUPABASE_PUBLISHABLE_KEY is missing');

const isStagingEnv = appEnv === 'staging' || appEnv === 'test' || requireStaging;
const isProdEnv = appEnv === 'production' || requireProduction;

if (requireStaging && requireProduction) {
  fail('Cannot require both staging and production');
}

if (isStagingEnv) {
  if (!url.includes(STAGING_REF)) {
    fail(
      `Staging build must use staging Supabase (${STAGING_REF}). Got: ${url}`,
    );
  }
  if (url.includes(PROD_REF)) {
    fail(`Staging build incorrectly points at PRODUCTION Supabase: ${url}`);
  }
  if (key.includes(PROD_REF) || key.includes('Imtremt1eWhnZHZ5ZWNteHRta3B5')) {
    // JWT payloads are base64; production ref appears base64-ish in anon key payload
    // Safer: decode middle segment if possible
  }
  // Decode JWT payload (anon keys are JWTs) and verify ref claim when present
  try {
    const payload = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString('utf8'),
    );
    if (payload.ref && payload.ref !== STAGING_REF) {
      fail(
        `Staging anon key ref=${payload.ref} does not match staging project ${STAGING_REF}`,
      );
    }
  } catch {
    // non-JWT publishable keys - URL check is sufficient
  }
  console.log(`✅ Staging Supabase locked: ${url}`);
  process.exit(0);
}

if (isProdEnv || (!isStagingEnv && !requireStaging)) {
  if (url.includes(STAGING_REF)) {
    fail(`Production build incorrectly points at STAGING Supabase: ${url}`);
  }
  if (!url.includes(PROD_REF) && requireProduction) {
    fail(`Production build must use production Supabase (${PROD_REF}). Got: ${url}`);
  }
  try {
    const payload = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString('utf8'),
    );
    if (payload.ref && payload.ref === STAGING_REF) {
      fail(`Production anon key points at staging ref=${payload.ref}`);
    }
  } catch {
    // ignore
  }
  console.log(`✅ Production Supabase check OK: ${url}`);
  process.exit(0);
}

console.log(`✅ Supabase env check passed (${appEnv}): ${url}`);
