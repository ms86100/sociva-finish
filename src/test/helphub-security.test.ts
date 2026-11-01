import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261101140000_helphub_core.sql'),
  'utf8',
);

describe('HelpHub security migration contracts', () => {
  it('enforces society isolation on listings select', () => {
    expect(migration).toContain('society_id = public.get_user_society_id(auth.uid())');
    expect(migration).toContain('Cross-society access denied');
  });

  it('requires consent before publishing', () => {
    expect(migration).toContain('Consent is required before publishing');
    expect(migration).toContain('helphub_consent_records');
    expect(migration).toContain('helphub_consent_v1');
  });

  it('keeps enquiry contact private by default', () => {
    expect(migration).toContain('shared_phone');
    expect(migration).toContain("p_status = 'contact_shared'");
    expect(migration).toContain('Phone required to share contact');
  });

  it('dedupes open enquiries and rate-limits creates', () => {
    expect(migration).toContain('helphub_enquiries_open_unique');
    expect(migration).toContain('Rate limit: too many listings');
    expect(migration).toContain('Rate limit: too many enquiries');
  });

  it('gates writes with helphub feature flag', () => {
    expect(migration).toContain("can_access_feature(public.get_user_society_id(auth.uid()), 'helphub')");
    expect(migration).toContain("feature_key = 'helphub'");
  });

  it('expires active listings and notifies owners', () => {
    expect(migration).toContain('helphub_expire_listings');
    expect(migration).toContain('helphub_notify_expiring_soon');
    expect(migration).toContain("'helphub_expiry'");
  });

  it('restricts suspend to admins', () => {
    expect(migration).toContain('Only admins can suspend listings');
  });
});

describe('HelpHub UI privacy copy', () => {
  it('listing and find pages avoid verified-worker claims', () => {
    const listingPage = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/helphub/HelpHubListingPage.tsx'),
      'utf8',
    );
    const findPage = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/helphub/HelpHubFindPage.tsx'),
      'utf8',
    );
    const combined = `${listingPage}\n${findPage}`;
    expect(combined).not.toMatch(/background.?verif|professionally vetted|verified worker/i);
    expect(combined).toMatch(/private/i);
  });
});
