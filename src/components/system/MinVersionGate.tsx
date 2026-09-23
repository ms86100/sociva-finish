import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/components/landing/LandingDownload';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { isVersionBelow } from '@/lib/min-app-version';

const WEB_APP_VERSION = '2.0.0';

export function MinVersionGate({ children }: { children: ReactNode }) {
  const { minSupportedAppVersion } = useSystemSettings();
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        if (!cancelled && info?.version) setNativeVersion(info.version);
      } catch {
        // Web and tests have no native app info.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = nativeVersion || WEB_APP_VERSION;
  if (!isVersionBelow(current, minSupportedAppVersion)) return <>{children}</>;

  const storeUrl = nativeVersion
    ? /android/i.test(navigator.userAgent)
      ? ANDROID_PLAY_STORE_URL
      : IOS_APP_STORE_URL
    : IOS_APP_STORE_URL;

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-bold">Update Sociva</h1>
        <p className="text-sm text-muted-foreground">
          This version ({current}) is no longer supported. Update to {minSupportedAppVersion} or newer to keep ordering.
        </p>
        <Button asChild className="w-full">
          <a href={storeUrl}>Update now</a>
        </Button>
      </div>
    </div>
  );
}
