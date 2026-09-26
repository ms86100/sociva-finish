import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { storeUpdateButtons } from '@/lib/app-update-link';

type AppUpdateNotice = {
  enabled: boolean;
  title: string;
  message: string;
};

async function openStore(url: string) {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return;
  }
  window.location.assign(url);
}

export function AppUpdateBanner() {
  const { data } = useQuery({
    queryKey: ['app-update-notice'],
    queryFn: async (): Promise<AppUpdateNotice | null> => {
      const { data: row, error } = await (supabase as any)
        .from('app_update_notices')
        .select('enabled, title, message')
        .eq('id', 1)
        .maybeSingle();
      if (error || !row?.enabled) return null;
      return row as AppUpdateNotice;
    },
    staleTime: 60_000,
  });

  if (!data) return null;

  const buttons = storeUpdateButtons(Capacitor.getPlatform());

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
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
                onClick={() => void openStore(button.url)}
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
