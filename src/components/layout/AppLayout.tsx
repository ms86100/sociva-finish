// @ts-nocheck
import { ReactNode, useLayoutEffect } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { FloatingCartBar } from '@/components/cart/FloatingCartBar';
import { NavigatorBackButton } from '@/components/admin/NavigatorBackButton';
import { EnableNotificationsBanner } from '@/components/notifications/EnableNotificationsBanner';
import { useAppLayoutShell } from '@/contexts/AppLayoutContext';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
  showHeader?: boolean;
  showNav?: boolean;
  showCart?: boolean;
  showLocation?: boolean;
  showBack?: boolean;
  headerTitle?: string;
  className?: string;
}

/**
 * Dual-mode layout:
 * - Inside AppShell: only syncs chrome options (Header/Nav stay mounted).
 * - Outside AppShell (public pages): renders chrome locally as before.
 */
export function AppLayout({
  children,
  showHeader = true,
  showNav = true,
  showCart = true,
  showLocation = true,
  showBack,
  headerTitle,
  className,
}: AppLayoutProps) {
  const shell = useAppLayoutShell();
  const setOptions = shell?.setOptions;
  const isPersistent = !!shell?.isPersistent;

  useLayoutEffect(() => {
    if (!setOptions || !isPersistent) return;
    setOptions({
      showHeader,
      showNav,
      showCart,
      showLocation,
      showBack,
      headerTitle,
      className,
    });
  }, [setOptions, isPersistent, showHeader, showNav, showCart, showLocation, showBack, headerTitle, className]);

  if (isPersistent) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {showHeader && (
        <Header
          showCart={showCart}
          showLocation={showLocation}
          showBack={showBack}
          title={headerTitle}
        />
      )}
      <main className={cn('pb-24', className)}>
        <EnableNotificationsBanner />
        {children}
      </main>
      <NavigatorBackButton />
      {showCart && <FloatingCartBar />}
      {showNav && <BottomNav />}
    </div>
  );
}
