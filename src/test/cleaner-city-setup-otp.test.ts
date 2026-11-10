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
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityHomePage.tsx'),
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

  it('CleanerCitySetupPage detects company from any work email domain', () => {
    expect(setupPage).toContain('cleaner-city-setup-steps');
    expect(setupPage).not.toContain('Approved companies');
    expect(setupPage).not.toContain('Request domain approval');
    expect(setupPage).toContain('cleaner-city-domain-check');
    expect(setupPage).toContain('detectedCompany');
    expect(setupPage).toContain('useCheckWorkEmailDomain');
    expect(setupPage).not.toContain('useRequestCompanyDomain');
    expect(setupPage).not.toContain('useApprovedCompanyDomains');
  });

  it('Edge function source contains mapStoreError and mapResendError', () => {
    expect(edge).toContain('function mapStoreError');
    expect(edge).toContain('function mapResendError');
    expect(edge).toContain('cleaner_city_check_work_email_domain');
  });

  it('Hub page has one-step welcome setup', () => {
    expect(hubPage).toContain('cleaner-city-hub-welcome');
    expect(hubPage).toContain('cleaner-city-hub-next-step');
  });

  it('setup steps use underline tabs like Offer', () => {
    expect(setupPage).toContain('cleaner-city-setup-steps');
    expect(setupPage).toContain('border-b-2');
    expect(setupPage).toContain('border-primary text-primary');
    expect(setupPage).not.toContain('Step {s.n}');
  });
});

