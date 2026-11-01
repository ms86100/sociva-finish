import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import {
  dismissUpdateVersion,
  isUpdateDismissed,
  openAppStoreUrl,
  shouldShowSoftUpdate,
  softUpdateButtons,
} from '@/lib/app-update-policy';

type AppUpdateNotice = {
  enabled: boolean;
  title: string;
  message: string;
  latest_version: string | null;
};

export function AppUpdateBanner() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        if (!cancelled && info?.version) setInstalledVersion(info.version);
      } catch {
        // web / tests
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data } = useQuery({
    queryKey: ['app-update-notice'],
    queryFn: async (): Promise<AppUpdateNotice | null> => {
      const { data: row, error } = await (supabase as any)
        .from('app_update_notices')
        .select('enabled, title, message, latest_version')
        .eq('id', 1)
        .maybeSingle();
      if (error || !row?.enabled) return null;
      return row as AppUpdateNotice;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data) return;
    setDismissed(isUpdateDismissed(data.latest_version));
  }, [data]);

  if (!data) return null;

  const show = shouldShowSoftUpdate({
    enabled: data.enabled,
    latestVersion: data.latest_version,
    installedVersion,
    dismissed,
    isNative: Capacitor.isNativePlatform(),
  });
  if (!show) return null;

  // Prefer CapacitorCustomPlatform (E2E / custom shells) then getPlatform().
  const customPlatform =
    typeof window !== 'undefined'
      ? (window as unknown as { CapacitorCustomPlatform?: { name?: string } }).CapacitorCustomPlatform?.name
      : undefined;
  const buttons = softUpdateButtons(customPlatform || Capacitor.getPlatform());

  const handleDismiss = () => {
    dismissUpdateVersion(data.latest_version);
    setDismissed(true);
  };

  const handleOpen = async (url: string) => {
    const opened = await openAppStoreUrl(url);
    if (!opened) {
      toast.error('Could not open the store. Search for Sociva in the App Store or Google Play.');
    }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm relative">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss update"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <Download className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-semibold text-foreground">{data.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.message}</p>
          <div className="flex flex-wrap gap-2">
            {buttons.map((button) => (
              <Button
                key={button.id}
                size="sm"
                className="h-8"
                onClick={() => void handleOpen(button.url)}
              >
                {button.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
