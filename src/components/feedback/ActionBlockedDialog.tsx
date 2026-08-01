import { useEffect, useState } from 'react';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
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

  const handleAck = () => {
    const cb = s.onAck;
    closeNotify();
    cb?.();
  };

  return (
    <Dialog open={s.open} onOpenChange={(o) => { if (!o) closeNotify(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className={`mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full ${iconWrap}`}>
            <Icon className={`h-7 w-7 ${iconColor}`} aria-hidden />
          </div>
          <DialogTitle className="text-center">{s.title}</DialogTitle>
          {s.message && (
            <DialogDescription className="text-center text-foreground/80">
              {s.message}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button onClick={handleAck} className="min-w-[120px]">
            {s.okLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ActionBlockedDialog;
