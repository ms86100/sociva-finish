import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
);
const patchScript = readFileSync(
  resolve(__dirname, '../../scripts/patch-android-builds.cjs'),
  'utf8',
);

describe('Android location dependency compatibility', () => {
  it('uses the Capacitor 8 compatible Transistorsoft generation', () => {
    expect(packageJson.dependencies['@transistorsoft/capacitor-background-geolocation'])
      .toMatch(/^\^9\./);
  });

  it('supports the remote Maven layout used by Transistorsoft 9', () => {
    expect(patchScript).toMatch(/Transistorsoft Google Play Services 21 compatibility/);
    expect(patchScript).toMatch(/tslocationmanager-gms20/);
    expect(patchScript).toMatch(/maven\.transistorsoft\.com/);
  });
});
