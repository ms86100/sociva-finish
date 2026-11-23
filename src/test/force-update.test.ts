import { describe, expect, it, vi } from 'vitest';
import { forceUpdateCta, storeUrlForPlatform } from '@/lib/app-update-link';
import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/components/landing/LandingDownload';
import {
  allowForceUpdatePreview,
  consumeForceUpdatePreview,
  readForceUpdatePreviewParam,
  shouldShowForceUpdate,
} from '@/lib/force-update';

describe('hard force-update gate', () => {
  it('sends Android to Google Play and iOS to the App Store', () => {
    expect(storeUrlForPlatform('android')).toBe(ANDROID_PLAY_STORE_URL);
    expect(storeUrlForPlatform('ios')).toBe(IOS_APP_STORE_URL);
    expect(forceUpdateCta('android')).toEqual({
      id: 'android',
      label: 'Update on Google Play',
      url: ANDROID_PLAY_STORE_URL,
    });
    expect(forceUpdateCta('ios')).toEqual({
      id: 'ios',
      label: 'Update on the App Store',
      url: IOS_APP_STORE_URL,
    });
    expect(ANDROID_PLAY_STORE_URL).toContain('play.google.com');
    expect(ANDROID_PLAY_STORE_URL).toContain('app.sociva.community');
    expect(IOS_APP_STORE_URL).toContain('apps.apple.com');
    expect(IOS_APP_STORE_URL).toContain('id6759218504');
  });

  it('blocks old native installs and never blocks web or current installs', () => {
    const mins = { android: '2.0.90', ios: '2026.1101.1', shared: '2.0.80' };
    expect(
      shouldShowForceUpdate({
        install: { platform: 'android', version: '2.0.80' },
        mins,
      }).show,
    ).toBe(true);
    expect(
      shouldShowForceUpdate({
        install: { platform: 'android', version: '2.0.90' },
        mins,
      }).show,
    ).toBe(false);
    expect(
      shouldShowForceUpdate({
        install: { platform: 'ios', version: '2026.1011.1430' },
        mins,
      }).show,
    ).toBe(true);
    expect(shouldShowForceUpdate({ install: null, mins }).show).toBe(false);
    expect(
      shouldShowForceUpdate({
        install: { platform: 'android', version: '2.0.1' },
        mins: { shared: '', android: '', ios: '' },
      }).show,
    ).toBe(false);
  });

  it('keeps a preview after the marketing page strips the hash query', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    vi.stubGlobal('window', {
      location: { hash: '#/?force_update_preview=ios', search: '', hostname: '127.0.0.1' },
    });
    expect(consumeForceUpdatePreview()).toBe('ios');
    vi.stubGlobal('window', {
      location: { hash: '#/landing', search: '', hostname: '127.0.0.1' },
    });
    expect(consumeForceUpdatePreview()).toBe('ios');
    vi.unstubAllGlobals();
  });

  it('preview query is staging/dev only and has no skip path', () => {
    expect(readForceUpdatePreviewParam('#/?force_update_preview=android')).toBe('android');
    expect(readForceUpdatePreviewParam('#/home?force_update_preview=ios')).toBe('ios');
    expect(readForceUpdatePreviewParam('#/')).toBe(null);
    expect(
      shouldShowForceUpdate({
        previewPlatform: 'android',
        install: null,
        mins: {},
      }),
    ).toEqual({ show: true, platform: 'android', minimum: '' });
    expect(
      allowForceUpdatePreview({
        isDev: false,
        hostname: 'www.sociva.in',
        supabaseUrl: 'https://kkzkuyhgdvyecmxtmkpy.supabase.co',
      }),
    ).toBe(false);
    expect(
      allowForceUpdatePreview({
        isDev: false,
        hostname: '127.0.0.1',
        supabaseUrl: 'https://kkzkuyhgdvyecmxtmkpy.supabase.co',
      }),
    ).toBe(true);
    expect(
      allowForceUpdatePreview({
        isDev: false,
        hostname: 'sociva-integration.vercel.app',
        supabaseUrl: 'https://wwuanzbusxoyzixuprxs.supabase.co',
      }),
    ).toBe(true);
  });
});
