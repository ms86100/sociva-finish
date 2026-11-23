import { isVersionBelow, minimumVersionFor, type MinimumVersions } from '@/lib/min-app-version';

export type ForceUpdatePlatform = 'android' | 'ios';
export type NativeInstall = { platform: ForceUpdatePlatform; version: string };

export function allowForceUpdatePreview(opts?: {
  supabaseUrl?: string;
  isDev?: boolean;
  hostname?: string;
}): boolean {
  const isDev = opts?.isDev ?? Boolean(import.meta.env.DEV);
  if (isDev) return true;
  const host =
    opts?.hostname ??
    (typeof window !== 'undefined' ? window.location.hostname : '');
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const url = opts?.supabaseUrl ?? String(import.meta.env.VITE_SUPABASE_URL || '');
  return url.includes('wwuanzbusxoyzixuprxs');
}

const PREVIEW_STORAGE_KEY = 'sociva_force_update_preview';

/** HashRouter-safe: #/?force_update_preview=android or #/home?force_update_preview=ios */
export function readForceUpdatePreviewParam(
  hashAndSearch: string,
): ForceUpdatePlatform | null {
  const hash = hashAndSearch.includes('#')
    ? hashAndSearch.slice(hashAndSearch.indexOf('#') + 1)
    : hashAndSearch;
  const qIndex = hash.indexOf('?');
  const fromHash = qIndex >= 0 ? hash.slice(qIndex + 1) : '';
  const fromSearch =
    hashAndSearch.includes('?') && !hashAndSearch.includes('#')
      ? hashAndSearch.slice(hashAndSearch.indexOf('?') + 1)
      : '';
  const params = new URLSearchParams(fromHash || fromSearch);
  const raw = (params.get('force_update_preview') || '').toLowerCase();
  if (raw === 'android' || raw === 'ios') return raw;
  return null;
}

export function persistForceUpdatePreview(platform: ForceUpdatePlatform | null): void {
  if (typeof window === 'undefined' || !platform) return;
  try {
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, platform);
  } catch {
    // ignore
  }
}

export function consumeForceUpdatePreview(): ForceUpdatePlatform | null {
  if (typeof window === 'undefined' || !allowForceUpdatePreview()) return null;
  const fromUrl = readForceUpdatePreviewParam(`${window.location.hash}${window.location.search}`);
  if (fromUrl) {
    persistForceUpdatePreview(fromUrl);
    return fromUrl;
  }
  try {
    const stored = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (stored === 'android' || stored === 'ios') return stored;
  } catch {
    // ignore
  }
  return null;
}

export function shouldShowForceUpdate(opts: {
  previewPlatform?: ForceUpdatePlatform | null;
  install: NativeInstall | null;
  mins: MinimumVersions;
}): { show: boolean; platform: ForceUpdatePlatform | null; minimum: string } {
  if (opts.previewPlatform === 'android' || opts.previewPlatform === 'ios') {
    return { show: true, platform: opts.previewPlatform, minimum: '' };
  }
  if (!opts.install) {
    return { show: false, platform: null, minimum: '' };
  }
  const minimum = minimumVersionFor(opts.install.platform, opts.mins);
  return {
    show: isVersionBelow(opts.install.version, minimum),
    platform: opts.install.platform,
    minimum,
  };
}

export async function readNativeInstall(): Promise<NativeInstall | null> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    const custom =
      typeof window !== 'undefined'
        ? (window as unknown as { CapacitorCustomPlatform?: { name?: string } })
            .CapacitorCustomPlatform?.name
        : undefined;
    const platform = String(custom || Capacitor.getPlatform() || '').toLowerCase();
    if (platform !== 'android' && platform !== 'ios') return null;
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      if (info?.version) return { platform, version: info.version };
    } catch {
      // E2E stubs platform without App.getInfo.
    }
    return null;
  } catch {
    return null;
  }
}
