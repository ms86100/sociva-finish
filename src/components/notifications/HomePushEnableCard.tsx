import { useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissionLifecycle } from '@/hooks/usePermissionLifecycle';
import { openAppNotificationSettings } from '@/lib/notification-channel-settings';
import { notificationAskCopy } from '@/lib/permission-prompt-rules';
import { peekPendingAuthAction } from '@/lib/pending-auth-action';

/**
 * Motivational notification ask. Allow opens the system dialog.
 * Not now hides it for a few days. Hidden once notifications are allowed.
 * Stays off cart, address, and checkout unless force is set after an order.
 */
export function HomePushEnableCard({ force = false }: { force?: boolean }) {
  const { isSeller, hasSellerProfile } = useAuth();
  const {
    showNotifSoftPrompt,
    notificationPermission,
    enableNotifications,
    dismissNotifPrompt,
  } = usePermissionLifecycle();
  const [busy, setBusy] = useState(false);

  const pending = peekPendingAuthAction();
  const checkoutInProgress =
    !force && (pending?.type === 'checkout' || pending?.type === 'add_to_cart');

  if (!showNotifSoftPrompt || checkoutInProgress) return null;

  const copy = notificationAskCopy(!!(isSeller || hasSellerProfile));
  const alreadyDenied = notificationPermission === 'denied';

  const handleAllow = async () => {
    setBusy(true);
    try {
      if (alreadyDenied) {
        const opened = await openAppNotificationSettings();
        if (!opened) {
          toast.error('Open Settings, then Sociva, then Notifications.');
        }
        return;
      }
      const result = await Promise.race([
        enableNotifications(),
        new Promise<'settings'>((resolve) => setTimeout(() => resolve('settings'), 15000)),
      ]);
      if (result === 'granted') {
        toast.success('Notifications are on');
        return;
      }
      // They just declined the system dialog. Ask again in a few days, not Settings now.
      dismissNotifPrompt();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/15 p-2 shrink-0">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-semibold text-foreground">{copy.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {alreadyDenied
              ? 'Notifications are off. Allow them so you do not miss an order update.'
              : copy.body}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleAllow()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : alreadyDenied ? 'Open Settings' : 'Allow'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={busy}
              onClick={() => dismissNotifPrompt()}
            >
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
