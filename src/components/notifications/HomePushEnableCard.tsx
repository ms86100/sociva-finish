import { useState } from 'react';
import { Bell, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePermissionLifecycle } from '@/hooks/usePermissionLifecycle';
import { openAppNotificationSettings } from '@/lib/notification-channel-settings';

/**
 * Home-only prompt to turn on push. Hidden once a token exists or the
 * 7-day dismiss cooldown is active. Does not touch location.
 */
export function HomePushEnableCard() {
  const { showNotifSoftPrompt, enableNotifications, dismissNotifPrompt } = usePermissionLifecycle();
  const [busy, setBusy] = useState(false);

  if (!showNotifSoftPrompt) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const result = await Promise.race([
        enableNotifications(),
        new Promise<'settings'>((resolve) => setTimeout(() => resolve('settings'), 15000)),
      ]);
      if (result === 'granted') {
        toast.success('Notifications are on');
        return;
      }
      const opened = await openAppNotificationSettings();
      if (!opened) {
        toast.error('Open Settings, then Sociva, then Notifications.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm relative">
      <button
        type="button"
        onClick={() => dismissNotifPrompt()}
        className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-semibold text-foreground">Hear it when your order moves</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Turn on notifications and you will know the moment a seller accepts, prepares, or sends your order.
          </p>
          <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleEnable()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Turn on notifications'}
          </Button>
        </div>
      </div>
    </div>
  );
}
