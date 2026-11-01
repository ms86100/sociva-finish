import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { softUpdateStoreUrl, openAppStoreUrl } from '@/lib/app-update-policy';
import { isVersionBelow, minimumVersionFor } from '@/lib/min-app-version';

type NativeInstall = { platform: 'android' | 'ios'; version: string };

export function MinVersionGate({ children }: { children: ReactNode }) {
  const { minSupportedAppVersion, minSupportedAndroidVersion, minSupportedIosVersion } = useSystemSettings();
  const [install, setInstall] = useState<NativeInstall | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        const platform = Capacitor.getPlatform();
        if (platform !== 'android' && platform !== 'ios') return;
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        if (!cancelled && info?.version) setInstall({ platform, version: info.version });
      } catch {
        // Web and tests have no native app info.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!install) return <>{children}</>;

  const minimum = minimumVersionFor(install.platform, {
    shared: minSupportedAppVersion,
    android: minSupportedAndroidVersion,
    ios: minSupportedIosVersion,
  });
  if (!isVersionBelow(install.version, minimum)) return <>{children}</>;

  const storeUrl = softUpdateStoreUrl(install.platform);

  const handleUpdate = async () => {
    setOpening(true);
    try {
      const opened = await openAppStoreUrl(storeUrl);
      if (!opened) {
        toast.error('Could not open the store. Search for Sociva in the App Store or Google Play.');
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-bold">Update Sociva</h1>
        <p className="text-sm text-muted-foreground">
          This version ({install.version}) is no longer supported. Update to {minimum} or newer to keep ordering.
        </p>
        <Button className="w-full" disabled={opening} onClick={() => void handleUpdate()}>
          Update now
        </Button>
      </div>
    </div>
  );
}
