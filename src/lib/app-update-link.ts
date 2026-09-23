import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/components/landing/LandingDownload';

/** True when the link is the universal store update URL, not an in-app route. */
export function isAppUpdatePath(path: string): boolean {
  const bare = (path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return bare === '/update';
}

export function storeUrlForPlatform(platform: string): string {
  return /android/i.test(platform) ? ANDROID_PLAY_STORE_URL : IOS_APP_STORE_URL;
}
