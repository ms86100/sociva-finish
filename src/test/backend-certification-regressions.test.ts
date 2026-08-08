import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20260808052243_fix_certification_backend_failures.sql',
  ),
  'utf8',
);
const notificationAuthMigration = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20260808052915_fix_notification_worker_scheduler_auth.sql',
  ),
  'utf8',
);

describe('backend production-certification repairs', () => {
  it('enables RLS on the internal PNQ gate without granting client access', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\._pnq_wakeup_gate ENABLE ROW LEVEL SECURITY/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\._pnq_wakeup_gate FROM PUBLIC, anon, authenticated/,
    );
  });

  it('writes order audit target_id as UUID', () => {
    expect(migration).toMatch(/'order',\s*NEW\.id,\s*NEW\.society_id/);
    expect(migration).not.toMatch(/'order',\s*NEW\.id::text/);
  });

  it('authenticates database wake-ups with the dedicated worker secret', () => {
    expect(notificationAuthMigration).toMatch(/name = 'pnq_worker_secret'/);
    expect(notificationAuthMigration).toMatch(/'x-cron-secret', v_worker_secret/);
    expect(notificationAuthMigration).not.toMatch(/'Authorization', 'Bearer '/);
  });
});
