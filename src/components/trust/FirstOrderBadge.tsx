// @ts-nocheck
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FirstOrderBadgeProps {
  className?: string;
  variant?: 'inline' | 'card';
}

export function FirstOrderBadge({ className, variant = 'inline' }: FirstOrderBadgeProps) {
  if (variant === 'card') {
    return (
      <div className={cn(
        'flex items-center gap-2.5 bg-success/10 border border-success/20 rounded-xl px-3 py-2.5',
        className
      )}>
        <ShieldCheck size={18} className="text-success shrink-0" />
        <div>
        <p className="text-xs font-bold text-success">🛡 Buyer Protection</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Full refund if seller doesn't respond within 48 hours</p>
        </div>
      </div>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[8px] font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5',
      className
    )}>
      <ShieldCheck size={8} />
      Buyer Protected
    </span>
  );
}
