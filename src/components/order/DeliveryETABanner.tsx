// @ts-nocheck
import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { computeETA, ETAMood } from '@/lib/etaEngine';

interface DeliveryETABannerProps {
  estimatedDeliveryAt: string;
}

const MOOD_STYLES: Record<ETAMood, { bg: string; iconBg: string; iconColor: string }> = {
  calm: {
    bg: 'bg-accent/10 border-accent/20',
    iconBg: 'bg-accent/20',
    iconColor: 'text-accent',
  },
  eager: {
    bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/30',
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  imminent: {
    bg: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800/30',
    iconBg: 'bg-green-100 dark:bg-green-900/30',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  late: {
    bg: 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800/30',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
};

export function DeliveryETABanner({ estimatedDeliveryAt }: DeliveryETABannerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const eta = computeETA(estimatedDeliveryAt, now);
  const style = MOOD_STYLES[eta.mood];

  return (
    <div className={`${style.bg} border rounded-xl px-4 py-3 flex items-center gap-3`}>
      <div className={`w-9 h-9 rounded-full ${style.iconBg} flex items-center justify-center shrink-0`}>
        <Clock size={18} className={style.iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          <span className="mr-1.5">{eta.emoji}</span>
          {eta.displayText}
        </p>
        <p className="text-[11px] text-muted-foreground">{eta.subtitle}</p>
      </div>
    </div>
  );
}
