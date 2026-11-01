import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  dismissUpdateVersion,
  isUpdateDismissed,
  shouldShowSoftUpdate,
  updateDismissStorageKey,
} from '@/lib/app-update-policy';
import { isVersionBelow } from '@/lib/min-app-version';

function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

describe('app update soft policy', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('compares semver via shared isVersionBelow', () => {
    expect(isVersionBelow('2.0.80', '2.0.90')).toBe(true);
    expect(isVersionBelow('2.0.90', '2.0.90')).toBe(false);
    expect(isVersionBelow('2.1.0', '2.0.90')).toBe(false);
  });

  it('shows soft update when enabled and below latest on native', () => {
    expect(
      shouldShowSoftUpdate({
        enabled: true,
        latestVersion: '2.0.90',
        installedVersion: '2.0.80',
        isNative: true,
      }),
    ).toBe(true);
    expect(
      shouldShowSoftUpdate({
        enabled: true,
        latestVersion: '2.0.90',
        installedVersion: '2.0.90',
        isNative: true,
      }),
    ).toBe(false);
  });

  it('hides soft update on native until installed version is known', () => {
    expect(
      shouldShowSoftUpdate({
        enabled: true,
        latestVersion: '2.0.90',
        installedVersion: null,
        isNative: true,
      }),
    ).toBe(false);
    expect(
      shouldShowSoftUpdate({
        enabled: true,
        latestVersion: '2.0.90',
        installedVersion: '',
        isNative: true,
      }),
    ).toBe(false);
  });

  it('remembers dismiss for the same version', () => {
    expect(isUpdateDismissed('2.0.90')).toBe(false);
    dismissUpdateVersion('2.0.90');
    expect(isUpdateDismissed('2.0.90')).toBe(true);
    expect(localStorage.getItem(updateDismissStorageKey('2.0.90'))).toBe('1');
    expect(
      shouldShowSoftUpdate({
        enabled: true,
        latestVersion: '2.0.90',
        installedVersion: '2.0.80',
        dismissed: true,
        isNative: true,
      }),
    ).toBe(false);
  });

  it('hides when disabled', () => {
    expect(
      shouldShowSoftUpdate({
        enabled: false,
        latestVersion: '2.0.90',
        installedVersion: '2.0.80',
        isNative: true,
      }),
    ).toBe(false);
  });
});
