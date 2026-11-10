import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMatchReason, formatMatchReasons } from '@/lib/cleaner-city/matchCopy';

const root = process.cwd();
const migration = fs.readFileSync(
  path.resolve(root, 'supabase/migrations/20261102230000_cleaner_city_phase1_remediation.sql'),
  'utf8',
);
const routePage = fs.readFileSync(
  path.resolve(root, 'src/pages/cleaner-city/CleanerCityRoutePage.tsx'),
  'utf8',
);
const safetyPage = fs.readFileSync(
  path.resolve(root, 'src/pages/cleaner-city/CleanerCitySafetyPage.tsx'),
  'utf8',
);
const circlesPage = fs.readFileSync(
  path.resolve(root, 'src/pages/cleaner-city/CleanerCityCirclesPage.tsx'),
  'utf8',
);
const hubPage = fs.readFileSync(
  path.resolve(root, 'src/pages/cleaner-city/CleanerCityFindPage.tsx'),
  'utf8',
);
const ridePage = fs.readFileSync(
  path.resolve(root, 'src/pages/cleaner-city/CleanerCityRidePage.tsx'),
  'utf8',
);
const hookFile = fs.readFileSync(
  path.resolve(root, 'src/hooks/queries/useCleanerCity.ts'),
  'utf8',
);

describe('Cleaner City Phase 1 remediation - security SQL contracts', () => {
  it('restricts publication SELECT to host/admin (no society published full-row)', () => {
    expect(migration).toContain('CREATE POLICY commute_publications_select');
    expect(migration).toContain('host_user_id = auth.uid()');
    // Society peers must not gain published-row access via this policy body
    const policyBlock = migration.slice(
      migration.indexOf('CREATE POLICY commute_publications_select'),
      migration.indexOf('COMMENT ON POLICY commute_publications_select'),
    );
    expect(policyBlock).not.toMatch(/status IN \('published'/);
    expect(policyBlock).not.toMatch(/get_user_society_id\(auth\.uid\(\)\)/);
  });

  it('restricts circle SELECT to members and adds invite expiry + leave/remove', () => {
    expect(migration).toContain('invite_expires_at');
    expect(migration).toContain('cleaner_city_leave_circle');
    expect(migration).toContain('cleaner_city_remove_circle_member');
    expect(migration).toContain('cleaner_city_rotate_circle_invite');
    const circlePolicy = migration.slice(
      migration.indexOf('CREATE POLICY commute_circles_read'),
      migration.indexOf('COMMENT ON POLICY commute_circles_read'),
    );
    expect(circlePolicy).toContain('commute_circle_members');
    expect(circlePolicy).not.toContain('society_id = public.get_user_society_id');
  });

  it('enforces server-side publish pin validation', () => {
    expect(migration).toContain('Valid pickup coordinates required before publishing');
    expect(migration).toContain('Valid office coordinates required before publishing');
    expect(migration).toContain('Pickup coordinates out of range');
  });

  it('cascades publication cancel to guest rides and notifies', () => {
    expect(migration).toContain('cancelled_by_publication');
    expect(migration).toContain('Host cancelled the commute');
  });

  it('notifies waitlist on seat release and excludes blocks', () => {
    expect(migration).toContain('cleaner_city_release_publication_seat');
    expect(migration).toContain('commute_blocks');
    expect(migration).toContain('This is not a reserved seat');
  });

  it('blocks cross-publication double booking and hardens autopilot', () => {
    expect(migration).toContain(
      'You already have an active ride for this date and direction',
    );
    expect(migration).toContain('uq_commute_publications_host_date_dir_active');
    expect(migration).toContain('cleaner_city_is_work_email_verified(cp.user_id)');
  });

  it('returns honest SOS fan-out metadata and never claims SMS/112', () => {
    expect(migration).toContain("'sms_sent', false");
    expect(migration).toContain("'dialed_112', false");
    expect(migration).toContain('phone_only_contacts_skipped');
    expect(migration).toContain('cleaner_city_resolve_emergency_notify_user');
  });
});

describe('Cleaner City Phase 1 remediation - UI honesty', () => {
  it('RoutePage never writes Bangalore fallback coordinates', () => {
    expect(routePage).not.toContain('12.9716');
    expect(routePage).not.toContain('77.5946');
    const panel = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/cleaner-city/CleanerCityRouteSetupPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('Place the pin on your home first');
    expect(panel).toContain('Pin your office on the map');
  });

  it('Safety page links Sociva contacts by phone and stays honest about SMS', () => {
    expect(safetyPage).toContain('cleaner_city_resolve_emergency_notify_user');
    expect(safetyPage).toContain('SMS template is configured');
    expect(safetyPage).toContain('not a 112 dialer');
  });

  it('Circles page supports leave and rotate invite', () => {
    expect(circlesPage).toContain('useLeaveCircle');
    expect(circlesPage).toContain('useRotateCircleInvite');
    expect(circlesPage).toContain('cleaner-city-circle-leave');
    expect(hookFile).toContain('cleaner_city_leave_circle');
    expect(hookFile).toContain('cleaner_city_rotate_circle_invite');
  });

  it('Hub and match copy no longer claim real route overlap', () => {
    expect(hubPage).not.toContain('Match by route overlap');
    expect(formatMatchReason('overlap_proxy_ok')).toContain('Good route match');
    expect(formatMatchReasons(['overlap_soft_below_target'])).toContain('Partial route match');
  });

  it('Ride SOS gates tools, shows honest fan-out, and is not a 112 dialer', () => {
    expect(ridePage).toContain('canShowRideSos');
    expect(ridePage).toContain('canShowTripShare');
    expect(ridePage).toContain('notified_contacts');
    expect(ridePage).toContain('phone_only_contacts_skipped');
    expect(ridePage).toContain('not a 112 dialer');
    expect(ridePage).toContain('Call 112');
    expect(ridePage).toContain('/cleaner-city/safety');
  });
});

