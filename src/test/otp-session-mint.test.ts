import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('OTP session mint (no wasted MSG91 OTP)', () => {
  it('awaits email heal before generateLink and mints session server-side', () => {
    const src = read('supabase/functions/msg91-verify-otp/index.ts');
    expect(src).toMatch(/await withTimeout\(\s*admin\.auth\.admin\.updateUserById/);
    expect(src).toMatch(/auth\/v1\/verify/);
    expect(src).toMatch(/access_token/);
    expect(src).toMatch(/refresh_token/);
    expect(src).not.toMatch(/void \(async \(\) => \{\s*try \{\s*await admin\.auth\.admin\.updateUserById/);
  });

  it('client prefers setSession and forces fresh OTP after consume', () => {
    const src = read('src/hooks/useAuthPage.ts');
    expect(src).toMatch(/otpConsumedNeedsFreshRef/);
    expect(src).toMatch(/setSession\(\{\s*access_token/);
    expect(src).toMatch(/Phone verified, but sign-in timed out/);
    expect(src).toMatch(/forceFresh/);
  });

  it('QA bypass phones never retry MSG91 with apple-review-bypass reqId', () => {
    const send = read('supabase/functions/msg91-send-otp/index.ts');
    expect(send).toMatch(/reqId === "apple-review-bypass"/);
    expect(send).not.toMatch(/9535115316/);
    const client = read('src/hooks/useAuthPage.ts');
    expect(client).toMatch(/QA_OTP_REQ_ID/);
    expect(client).toMatch(/if \(resend\) \{/);
    expect(client).not.toMatch(/if \(resend \|\| forceFresh\) \{/);
  });

  it('seller messages loads contact leads for all stores', () => {
    const src = read('src/pages/SellerMessagesPage.tsx');
    expect(src).toMatch(/sellerProfiles\.map\(\(s\) => s\.id\)/);
    expect(src).not.toMatch(/if \(activeSellerId\) return \[activeSellerId\]/);
  });
});
