import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifySellerLocationError,
  isNativePluginUnimplemented,
  looksLikeTechnicalLocationError,
  sellerLocationErrorMessage,
} from '@/lib/location-tracking-errors';

const require = createRequire(import.meta.url);
const { patch } = require('../../scripts/patch-ios-podfile.cjs') as {
  patch: (content: string) => string;
};

const ordersPage = readFileSync(resolve(__dirname, '../pages/OrdersPage.tsx'), 'utf8');
const hook = readFileSync(resolve(__dirname, '../hooks/useBackgroundLocationTracking.ts'), 'utf8');

describe('iOS BackgroundGeolocation native wiring', () => {
  it('restores Transistorsoft when CI used to overwrite the Podfile', () => {
    const stale = `
require_relative '../../node_modules/@capacitor/ios/scripts/pods_helpers'
platform :ios, '15.0'
use_frameworks!
def capacitor_pods
    pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
    pod 'CapacitorGeolocation', :path => '../../node_modules/@capacitor/geolocation'
end
target 'App' do
  capacitor_pods
end
`;
    const patched = patch(stale);
    expect(patched).toMatch(/pod 'TransistorsoftCapacitorBackgroundGeolocation'/);
    expect(patched).toMatch(/use_frameworks! :linkage => :static/);
    expect(patched).toMatch(/platform :ios, '16.1'/);
    expect(patched).toMatch(/pod 'FirebaseCore'/);
    expect(patched).toMatch(/SWIFT_ENABLE_EXPLICIT_MODULES/);
    expect(patch(patched)).toMatch(/TransistorsoftCapacitorBackgroundGeolocation/);
  });
});

describe('seller location error copy', () => {
  it('detects Capacitor unimplemented plugin errors', () => {
    expect(
      isNativePluginUnimplemented({
        message: '"BackgroundGeolocation" plugin is not implemented on ios',
      }),
    ).toBe(true);
    expect(isNativePluginUnimplemented({ code: 'UNIMPLEMENTED' })).toBe(true);
    expect(isNativePluginUnimplemented({ message: 'permission denied' })).toBe(false);
  });

  it('never returns plugin or class names to the seller', () => {
    const msg = sellerLocationErrorMessage({
      message: '"BackgroundGeolocation" plugin is not implemented on ios',
    });
    expect(msg.toLowerCase()).not.toContain('backgroundgeolocation');
    expect(msg.toLowerCase()).not.toContain('plugin');
    expect(msg.toLowerCase()).not.toContain('implemented');
    expect(classifySellerLocationError({ message: 'permission denied' })).toBe('permission_denied');
    expect(classifySellerLocationError({ message: 'Location services are disabled' })).toBe('services_off');
    expect(looksLikeTechnicalLocationError(msg)).toBe(false);
  });

  it('keeps the tracking hook off raw Location error interpolation', () => {
    expect(hook).not.toMatch(/Location error: \$\{errMsg/);
    expect(hook).toMatch(/sellerLocationErrorMessage/);
  });
});

describe('Orders page multi-store card wiring', () => {
  it('imports CheckoutGroupCard so grouped checkouts can render', () => {
    expect(ordersPage).toMatch(/import \{ CheckoutGroupCard \} from '@\/components\/order\/CheckoutGroupCard'/);
    expect(ordersPage).toMatch(/SafeSectionWrapper/);
  });
});
