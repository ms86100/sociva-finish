import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const u9 = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102190000_cleaner_city_unit9_tracking_safety.sql'),
  'utf8',
);
const u1012 = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102200000_cleaner_city_unit10_11_12_complete.sql'),
  'utf8',
);
const ridePage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityRidePage.tsx'),
  'utf8',
);
const adminTab = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/admin/AdminCleanerCityTab.tsx'),
  'utf8',
);

describe('A Cleaner City Units 9-12 contracts', () => {
  it('restricts live location to active ride participants with rate limit', () => {
    expect(u9).toContain('cleaner_city_upsert_ride_location');
    expect(u9).toContain('Live location only during active ride');
    expect(u9).toContain("interval '3 seconds'");
    expect(u9).toContain('cleaner_city_is_ride_participant');
    expect(ridePage).toContain('cleaner-city-sos');
  });

  it('supports SOS incidents and trip share tokens', () => {
    expect(u9).toContain('cleaner_city_report_incident');
    expect(u9).toContain("status = 'safety_incident'");
    expect(u9).toContain('cleaner_city_create_share_token');
    expect(u9).toContain('cleaner_city_view_shared_ride');
    expect(ridePage).toContain('Trip share');
  });

  it('blocks users from matching and exposes reputation', () => {
    expect(u1012).toContain('cleaner_city_block_user');
    expect(u1012).toContain('commute_blocks');
    expect(u1012).toContain('cleaner_city_reputation');
    expect(u1012).toContain('NOT EXISTS');
    expect(ridePage).toContain('Block this partner');
  });

  it('enqueues ride notifications with idempotency keys', () => {
    expect(u1012).toContain('cleaner_city_enqueue_notify');
    expect(u1012).toContain('cleaner_city_ride_request');
    expect(u1012).toContain('ON CONFLICT (user_id, idempotency_key)');
    expect(u1012).toContain('Rate limit: too many ride requests');
  });

  it('ships admin stats, incident resolve, and match scope controls', () => {
    expect(u1012).toContain('cleaner_city_admin_stats');
    expect(u1012).toContain('cleaner_city_admin_resolve_incident');
    expect(u1012).toContain('cleaner_city_admin_set_match_scope');
    expect(adminTab).toContain('Open safety incidents');
    expect(adminTab).toContain('Match scope');
  });
});
