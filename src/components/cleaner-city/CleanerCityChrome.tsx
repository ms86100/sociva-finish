import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityBottomNav } from '@/components/cleaner-city/CleanerCityBottomNav';
import { cn } from '@/lib/utils';

type Props = {
  children: ReactNode;
  headerTitle?: string;
  showHeader?: boolean;
  /** Ride mission / share: no Cleaner City tab bar */
  immersive?: boolean;
  className?: string;
};

/**
 * Shared chrome for production Cleaner City.
 * Hides marketplace BottomNav/cart and mounts the commute IA tab bar.
 */
export function CleanerCityChrome({
  children,
  headerTitle,
  showHeader = true,
  immersive = false,
  className,
}: Props) {
  return (
    <AppLayout
      showNav={false}
      showCart={false}
      showHeader={showHeader}
      headerTitle={headerTitle}
      className={cn(!immersive && 'pb-28', className)}
    >
      {children}
      {!immersive ? <CleanerCityBottomNav /> : null}
    </AppLayout>
  );
}
