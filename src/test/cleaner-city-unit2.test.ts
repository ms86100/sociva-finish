import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102100000_cleaner_city_unit2_profile_verification.sql'),
  'utf8',
);

const edge = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/functions/cleaner-city-work-email-otp/index.ts'),
  'utf8',
);

const setupPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCitySetupPage.tsx'),
  'utf8',
);

const hubPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityHomePage.tsx'),
  'utf8',
);

describe('A Cleaner City Unit 2 verification contracts', () => {
  it('blocks personal domains for work email verification', () => {
    expect(migration).toContain('cleaner_city_is_personal_or_disposable_domain');
    expect(migration).toContain('gmail.com');
    expect(migration).toContain('Personal or disposable email domains are not eligible');
  });

  it('gates ride participation on verified work email + active profile', () => {
    expect(migration).toContain('cleaner_city_require_verified_commuter');
    expect(migration).toContain('Work email must be verified before ride participation');
    expect(migration).toContain('Active commute profile required');
  });

  it('stores hashed OTP via service role and verifies without client plaintext secrets', () => {
    expect(migration).toContain('cleaner_city_store_work_email_otp');
    expect(migration).toContain('cleaner_city_verify_work_email_otp_hash');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.cleaner_city_store_work_email_otp');
    expect(migration).toContain('TO service_role');
  });

  it('edge function documents missing Resend credential instead of faking email', () => {
    expect(edge).toContain('email_provider_missing');
    expect(edge).toContain('RESEND_API_KEY');
    expect(edge).toContain('api.resend.com/emails');
  });

  it('setup UI uses Work email verified badge copy', () => {
    const constants = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/cleaner-city/constants.ts'),
      'utf8',
    );
    expect(constants).toContain("WORK_EMAIL_BADGE = 'Work email verified'");
    expect(setupPage).toContain('WORK_EMAIL_BADGE');
    expect(setupPage).not.toMatch(/employment independently verified/i);
    expect(hubPage).toContain('Unverified accounts cannot publish or book rides');
  });
});
