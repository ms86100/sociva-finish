#!/usr/bin/usr/bin/env node
/**
 * Helper notes for staging sync (no production writes).
 * Actual apply goes through Supabase MCP execute_sql on wwuanzbusxoyzixuprxs.
 *
 * Staging: wwuanzbusxoyzixuprxs
 * Production (read-only during sync): kkzkuyhgdvyecmxtmkpy
 */
'use strict';

const STAGING_REF = 'wwuanzbusxoyzixuprxs';
const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';

console.log(
  JSON.stringify(
    {
      staging: STAGING_REF,
      production: PROD_REF,
      rule: 'Never DDL or apply_migration against production during staging sync',
      frontend: ['npm run assert:staging', 'npm run dev:staging', 'npm run build:staging'],
    },
    null,
    2,
  ),
);
