import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/components/landing/LandingDownload';

/** True when the link is the universal store update URL, not an in-app route. */
export function isAppUpdatePath(path: string): boolean {
  const bare = (path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return bare === '/update';
}

export function storeUrlForPlatform(platform: string): string {
  return /android/i.test(platform) ? ANDROID_PLAY_STORE_URL : IOS_APP_STORE_URL;
}

export type StoreUpdateButton = {
  id: 'ios' | 'android';
  label: string;
  url: string;
};

const IOS_BUTTON: StoreUpdateButton = {
  id: 'ios',
  label: 'iOS - Update',
  url: IOS_APP_STORE_URL,
};

const ANDROID_BUTTON: StoreUpdateButton = {
  id: 'android',
  label: 'Android - Update',
  url: ANDROID_PLAY_STORE_URL,
};

/** Native shows only the matching store. Web shows both, each with a fixed URL. */
export function storeUpdateButtons(platform: string): StoreUpdateButton[] {
  if (/android/i.test(platform)) return [ANDROID_BUTTON];
  if (/ios|iphone|ipad/i.test(platform)) return [IOS_BUTTON];
  return [IOS_BUTTON, ANDROID_BUTTON];
}
