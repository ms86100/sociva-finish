import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { forceUpdateCta } from '@/lib/app-update-link';
import { openAppStoreUrl } from '@/lib/app-update-policy';
import {
  consumeForceUpdatePreview,
  readNativeInstall,
  shouldShowForceUpdate,
  type NativeInstall,
} from '@/lib/force-update';

export function MinVersionGate({ children }: { children: ReactNode }) {
  const { minSupportedAppVersion, minSupportedAndroidVersion, minSupportedIosVersion } =
    useSystemSettings();
  const [install, setInstall] = useState<NativeInstall | null>(null);
  const [nativeReady, setNativeReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const maybeNative =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
        ?.isNativePlatform?.(),
    );

  const previewPlatform = useMemo(() => consumeForceUpdatePreview(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const native = await readNativeInstall();
      if (!cancelled) {
        setInstall(native);
        setNativeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const decision = shouldShowForceUpdate({
    previewPlatform,
    install,
    mins: {
      shared: minSupportedAppVersion,
      android: minSupportedAndroidVersion,
      ios: minSupportedIosVersion,
    },
  });

  if (!previewPlatform && maybeNative && !nativeReady) {
    return <div className="min-h-screen bg-background" aria-hidden="true" />;
  }

  if (!decision.show || !decision.platform) return <>{children}</>;

  const cta = forceUpdateCta(decision.platform);
  const storeName = decision.platform === 'android' ? 'Google Play' : 'the App Store';

  const handleUpdate = async () => {
    setOpening(true);
    try {
      const opened = await openAppStoreUrl(cta.url);
      if (!opened) {
        toast.error(`Could not open ${storeName}. Search for Sociva there.`);
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="relative flex-1 min-h-[42vh] bg-primary/15 overflow-hidden flex items-center justify-center">
        <div className="pointer-events-none absolute -right-16 -top-10 h-48 w-48 rounded-full bg-primary/20 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 bottom-4 h-36 w-36 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-background shadow-lg">
          <Download className="h-12 w-12 text-primary" aria-hidden="true" />
        </div>
      </div>
      <div className="px-6 pt-8 pb-10 space-y-5 max-w-sm mx-auto w-full">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">App update is required</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {decision.minimum
              ? `You need Sociva ${decision.minimum} or newer to keep using the app.`
              : 'You need the new version of Sociva to keep using the app.'}
          </p>
        </div>
        <Button
          className="w-full h-12 rounded-xl text-base"
          disabled={opening}
          aria-label={cta.label}
          onClick={() => void handleUpdate()}
        >
          {opening ? 'Opening store...' : 'Update the app'}
        </Button>
      </div>
    </div>
  );
}
