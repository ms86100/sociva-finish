import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { razorpayNativeCheckoutOptions } from '@/lib/razorpay-native-checkout';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Razorpay native checkout shell', () => {
  it('enables UPI intent apps and collect together', () => {
    const options = razorpayNativeCheckoutOptions();
    expect(options.webview_intent).toBe(true);
    expect(options.method.upi).toBe(true);
    expect(options.config.display.blocks.upi_apps.instruments[0].flows).toContain('intent');
    expect(options.config.display.blocks.upi_id.instruments[0].flows).toContain('collect');
    expect(options.config.display.preferences.show_default_blocks).toBe(true);
    expect(options._.payment.redirect).toBe(false);
  });

  it('routes seller credits and marketplace checkout through the shared shell', () => {
    const credits = read('src/pages/SellerCreditsPage.tsx');
    const hook = read('src/hooks/useRazorpay.ts');
    expect(credits).toMatch(/openNativeRazorpayCheckout/);
    expect(credits).not.toMatch(/new window\.Razorpay/);
    expect(hook).toMatch(/razorpayNativeCheckoutOptions\(\)/);
    expect(hook).not.toMatch(/show_default_blocks: false/);
  });

  it('insets checkout with measured safe-area vars instead of a 44px iOS guess', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/body\.razorpay-active\.razorpay-ios/);
    expect(css).toMatch(/max\(var\(--app-safe-top, 0px\), env\(safe-area-inset-top, 0px\)\)/);
    expect(css).toMatch(/max\(var\(--app-safe-bottom, 0px\), env\(safe-area-inset-bottom, 0px\)\)/);
    expect(css).not.toMatch(/env\(safe-area-inset-top, 44px\)/);
  });

  it('declares UPI app visibility for iOS canOpenURL and Android package queries', () => {
    const cap = read('capacitor.config.ts');
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const ci = read('codemagic.yaml');
    expect(cap).toMatch(/LSApplicationQueriesSchemes/);
    expect(cap).toMatch(/gpay/);
    expect(cap).toMatch(/phonepe/);
    expect(manifest).toMatch(/android:scheme="gpay"/);
    expect(manifest).toMatch(/com.dreamplug.androidapp/);
    expect(ci).toMatch(/gpay phonepe paytmmp/);
  });
});
