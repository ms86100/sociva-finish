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
const { patch, resolvePaths } = require('../../scripts/patch-ios-podfile.cjs') as {
  patch: (content: string) => string;
  resolvePaths: (cwd?: string, scriptDir?: string, argv?: string[]) => {
    repoRoot: string;
    podfilePath: string;
  };
};

const ordersPage = readFileSync(resolve(__dirname, '../pages/OrdersPage.tsx'), 'utf8');
const hook = readFileSync(resolve(__dirname, '../hooks/useBackgroundLocationTracking.ts'), 'utf8');

describe('iOS native location wiring without Transistorsoft', () => {
  it('strips Transistorsoft when Capacitor re-adds it to the Podfile', () => {
    const stale = `
require_relative '../../node_modules/@capacitor/ios/scripts/pods_helpers'
platform :ios, '15.0'
use_frameworks!
def capacitor_pods
    pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
    pod 'CapacitorGeolocation', :path => '../../node_modules/@capacitor/geolocation'
    pod 'TransistorsoftCapacitorBackgroundGeolocation', :path => '../../node_modules/@transistorsoft/capacitor-background-geolocation'
end
target 'App' do
  capacitor_pods
end
`;
    const patched = patch(stale);
    expect(patched).not.toMatch(/TransistorsoftCapacitorBackgroundGeolocation/);
    expect(patched).toMatch(/use_frameworks! :linkage => :static/);
    expect(patched).toMatch(/platform :ios, '16.1'/);
    expect(patched).toMatch(/pod 'FirebaseCore'/);
    expect(patched).toMatch(/SWIFT_ENABLE_EXPLICIT_MODULES/);
    expect(patch(patched)).not.toMatch(/TransistorsoftCapacitorBackgroundGeolocation/);
  });

  it('declares NSMotionUsageDescription for App Store ITMS-90683', () => {
    const cap = readFileSync(resolve(__dirname, '../../capacitor.config.ts'), 'utf8');
    const yaml = readFileSync(resolve(__dirname, '../../codemagic.yaml'), 'utf8');
    expect(cap).toMatch(/NSMotionUsageDescription/);
    expect(yaml).toMatch(/NSMotionUsageDescription/);
    expect(yaml.match(/NSMotionUsageDescription/g)?.length).toBeGreaterThanOrEqual(4);
    expect(yaml).not.toMatch(/ERROR: Transistorsoft iOS pod missing/);
    expect(yaml).toMatch(/Transistorsoft iOS pod must not be present/);
    expect(yaml).not.toMatch(/TSLocationManagerLicense/);
  });

  it('writes ios/App/Podfile even when CI cwd is already ios/App', () => {
    const repo = resolve(__dirname, '../..');
    const scriptDir = resolve(repo, 'scripts');
    const fromIosApp = resolvePaths(resolve(repo, 'ios', 'App'), scriptDir, ['node', 'patch-ios-podfile.cjs']);
    expect(fromIosApp.repoRoot).toBe(repo);
    expect(fromIosApp.podfilePath).toBe(resolve(repo, 'ios', 'App', 'Podfile'));
    expect(fromIosApp.podfilePath.replace(/\\/g, '/')).not.toMatch(/ios\/App\/ios\/App/);

    const explicit = resolvePaths(resolve(repo, 'ios', 'App'), scriptDir, [
      'node',
      'patch-ios-podfile.cjs',
      '--podfile=Podfile',
    ]);
    expect(explicit.podfilePath).toBe(resolve(repo, 'ios', 'App', 'Podfile'));
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
