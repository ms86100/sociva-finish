import { useEffect, useState } from 'react';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  acknowledgeNotify,
  closeNotify,
  getNotifyState,
  subscribeNotify,
  type NotifyState,
  type NotifyVariant,
} from '@/lib/notify';

const VARIANT_STYLES: Record<
  NotifyVariant,
  { Icon: typeof ShieldAlert; iconWrap: string; iconColor: string }
> = {
  block: {
    Icon: ShieldAlert,
    iconWrap: 'bg-destructive/10',
    iconColor: 'text-destructive',
  },
  warn: {
    Icon: AlertTriangle,
    iconWrap: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
  },
  info: {
    Icon: Info,
    iconWrap: 'bg-primary/10',
    iconColor: 'text-primary',
  },
};

export function ActionBlockedDialog() {
  const [s, setS] = useState<NotifyState>(getNotifyState());

  useEffect(() => subscribeNotify(setS), []);

  const { Icon, iconWrap, iconColor } = VARIANT_STYLES[s.variant];

  return (
    <AlertDialog open={s.open}>
      <AlertDialogContent className="sm:max-w-sm rounded-[1.75rem] border-border/80 shadow-[0_24px_60px_-18px_hsl(var(--foreground)/0.35)] max-h-[calc(100dvh-var(--app-safe-top,0px)-var(--app-safe-bottom,0px)-2rem)]">
        <AlertDialogHeader className="items-center text-center">
          <div className={`mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full ${iconWrap}`}>
            <Icon className={`h-7 w-7 ${iconColor}`} aria-hidden />
          </div>
          <AlertDialogTitle className="text-center tracking-tight">{s.title}</AlertDialogTitle>
          {s.message && (
            <AlertDialogDescription className="text-center text-foreground/80">
              {s.message}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          {s.confirmation && (
            <AlertDialogCancel onClick={closeNotify} className="min-w-[110px]">
              {s.cancelLabel || 'Cancel'}
            </AlertDialogCancel>
          )}
          <AlertDialogAction onClick={acknowledgeNotify} className="min-w-[120px]">
            {s.okLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ActionBlockedDialog;
