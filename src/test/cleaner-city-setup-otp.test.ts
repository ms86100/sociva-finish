import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const hookFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/hooks/queries/useCleanerCity.ts'),
  'utf8',
);

const setupPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCitySetupPage.tsx'),
  'utf8',
);

const edge = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/functions/cleaner-city-work-email-otp/index.ts'),
  'utf8',
);

const hubPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityPage.tsx'),
  'utf8',
);

describe('A Cleaner City setup + work email OTP contracts', () => {
  it('useCleanerCity imports functionInvokeErrorMessage and uses it in useWorkEmailOtp', () => {
    expect(hookFile).toContain("import { functionInvokeErrorMessage } from '@/lib/function-invoke-error';");

    const otpSection = hookFile.slice(
      hookFile.indexOf('export function useWorkEmailOtp'),
      hookFile.indexOf('export type ApprovedCompanyDomain'),
    );
    expect(otpSection).toContain('functionInvokeErrorMessage');
    expect(otpSection).toContain("supabase.functions.invoke('cleaner-city-work-email-otp'");
  });

  it('CleanerCitySetupPage has steps, approved domains, domain check, and request domain', () => {
    expect(setupPage).toContain('cleaner-city-setup-steps');
    expect(setupPage).toContain('Approved companies');
    expect(setupPage).toContain('cleaner-city-domain-check');
    expect(setupPage).toContain('useRequestCompanyDomain');
    expect(setupPage).toContain('Request domain approval');
  });

  it('Edge function source contains mapStoreError and mapResendError', () => {
    expect(edge).toContain('function mapStoreError');
    expect(edge).toContain('function mapResendError');
    expect(edge).toContain('cleaner_city_check_work_email_domain');
  });

  it('Hub page has cleaner-city-setup-checklist', () => {
    expect(hubPage).toContain('cleaner-city-setup-checklist');
  });
});
