// @ts-nocheck
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SafeHeaderProps {
  children: ReactNode;
  className?: string;
  /** Override z-index (default: z-30) */
  zIndex?: 'z-10' | 'z-20' | 'z-30' | 'z-40' | 'z-50';
  /** Show bottom border (default: true) */
  bordered?: boolean;
  /** Use backdrop blur (default: false) */
  blur?: boolean;
}

/**
 * System-level safe-area header wrapper.
 *
 * Handles the device status-bar inset on iOS (notch) and Android.
 * Every page that opts out of `<Header>` via `showHeader={false}`
 * should wrap its custom sticky header in `<SafeHeader>`.
 *
 * Structural padding:  pt-[max(env(safe-area-inset-top,0px),0.75rem)]
 * Sticky positioning:  sticky top-0
 * Background:          bg-background (or bg-background/95 with blur)
 */
export function SafeHeader({
  children,
  className,
  zIndex = 'z-30',
  bordered = true,
  blur = false,
}: SafeHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0',
        zIndex,
        blur ? 'bg-background/95 backdrop-blur-sm' : 'bg-background',
        bordered && 'border-b border-border',
        'pt-[max(env(safe-area-inset-top,0px),0.75rem)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
