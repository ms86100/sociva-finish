// @ts-nocheck
import { useState, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Bell, CheckCircle2, XCircle, Loader2, Settings, RefreshCw } from 'lucide-react';
import { runPushDiagnostics } from '@/lib/pushDiagnostics';
import { summariseDiagnostics, type UserFriendlyStatus } from '@/lib/pushDiagnosticsSummary';
import { useAuth } from '@/contexts/AuthContext';
import { Capacitor } from '@capacitor/core';

export function NotificationHealthCheck() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<UserFriendlyStatus[] | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setStatuses(null);
    try {
      const results = await runPushDiagnostics(user?.id);
      setStatuses(summariseDiagnostics(results));
    } catch {
      setStatuses([{
        label: 'Error',
        ok: false,
        actionType: 'none',
        message: 'Could not complete the check — please try again later',
      }]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) runCheck();
  };

  const handleOpenSettings = async () => {
    try {
      const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
      const platform = Capacitor.getPlatform();
      if (platform === 'ios') {
        await NativeSettings.open({ optionIOS: IOSSettings.App, optionAndroid: AndroidSettings.ApplicationDetails });
      } else {
        await NativeSettings.open({ optionAndroid: AndroidSettings.AppNotification, optionIOS: IOSSettings.App });
      }
    } catch {
      // Silently fail on web
    }
  };

  const allOk = statuses?.every((s) => s.ok) ?? false;

  return (
    <Drawer open={open} onOpenChange={handleOpen}>
      <DrawerTrigger asChild>
        <button className="flex items-center gap-3 px-3 py-3.5 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors w-full text-left">
          <Bell size={18} className="text-muted-foreground shrink-0" />
          <span className="flex-1 text-sm font-medium">Check Notifications</span>
          <RefreshCw size={16} className="text-muted-foreground" />
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-center">Notification Status</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="animate-spin" size={20} />
              <span className="text-sm">Checking…</span>
            </div>
          )}

          {!loading && statuses && (
            <>
              {allOk && (
                <div className="flex items-center gap-2 rounded-xl bg-accent/10 border border-accent/30 px-4 py-3">
                  <CheckCircle2 size={20} className="text-accent shrink-0" />
                  <span className="text-sm font-medium text-accent">
                    Notifications are working correctly
                  </span>
                </div>
              )}

              {statuses.map((status) => (
                <div
                  key={status.label}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  {status.ok ? (
                    <CheckCircle2 size={20} className="text-accent shrink-0 mt-0.5" />
                  ) : (
                    <XCircle size={20} className="text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{status.message}</p>
                    {!status.ok && status.detail && (
                      <p className="text-[11px] text-muted-foreground mt-1 break-words">
                        {status.detail}
                      </p>
                    )}
                  </div>
                  {!status.ok && status.actionType === 'openSettings' && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={handleOpenSettings}>
                      <Settings size={14} className="mr-1" />
                      Settings
                    </Button>
                  )}
                  {!status.ok && status.actionType === 'retry' && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={runCheck}>
                      <RefreshCw size={14} className="mr-1" />
                      Retry
                    </Button>
                  )}
                </div>
              ))}

              {!allOk && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  If problems persist, try closing and reopening the app.
                </p>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
