// @ts-nocheck
import { ClipboardList, ChefHat, PackageCheck, Bike, CircleCheckBig, XCircle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ClipboardList,
  ChefHat,
  PackageCheck,
  Bike,
  CircleCheckBig,
  XCircle,
  Package,
};

interface StatusPhaseIconProps {
  icon: string;
  iconColor: string;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}

const SIZES = {
  sm: { container: 'w-7 h-7', icon: 14 },
  md: { container: 'w-8 h-8', icon: 16 },
  lg: { container: 'w-10 h-10', icon: 20 },
};

export function StatusPhaseIcon({ icon, iconColor, size = 'md', pulse }: StatusPhaseIconProps) {
  const IconComp = ICON_MAP[icon] || Package;
  const s = SIZES[size];
  // iconColor is like "text-blue-500 bg-blue-500/15" — split into text + bg
  const parts = iconColor.split(' ');
  const textClass = parts.find(p => p.startsWith('text-')) || 'text-primary';
  const bgClass = parts.find(p => p.startsWith('bg-')) || 'bg-primary/15';

  return (
    <div className={cn(
      s.container,
      'rounded-full flex items-center justify-center shrink-0 backdrop-blur-sm',
      bgClass,
      pulse && 'animate-pulse'
    )}>
      <IconComp size={s.icon} className={textClass} />
    </div>
  );
}
