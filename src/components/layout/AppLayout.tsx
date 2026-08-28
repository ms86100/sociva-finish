// @ts-nocheck
import { ReactNode, useLayoutEffect } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { FloatingCartBar } from '@/components/cart/FloatingCartBar';
import { NavigatorBackButton } from '@/components/admin/NavigatorBackButton';
import { EnableNotificationsBanner } from '@/components/notifications/EnableNotificationsBanner';
import { useAppLayoutShell } from '@/contexts/AppLayoutContext';
import { NavigationStackTracker } from '@/components/navigation/NavigationStackTracker';
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
  /**
   * Reserve status-bar space when the default Header is hidden.
   * Defaults to true when showHeader={false}. Pass false if the page uses
   * <SafeHeader> or an edge-to-edge hero with its own inset.
   */
  safeTop?: boolean;
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
  safeTop,
}: AppLayoutProps) {
  const shell = useAppLayoutShell();
  const setOptions = shell?.setOptions;
  const isPersistent = !!shell?.isPersistent;
  const effectiveSafeTop = safeTop ?? !showHeader;

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
      safeTop: effectiveSafeTop,
    });
  }, [setOptions, isPersistent, showHeader, showNav, showCart, showLocation, showBack, headerTitle, className, effectiveSafeTop]);

  if (isPersistent) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <NavigationStackTracker />
      {showHeader && (
        <Header
          showCart={showCart}
          showLocation={showLocation}
          showBack={showBack}
          title={headerTitle}
        />
      )}
      <main
        className={cn(
          'pb-24',
          effectiveSafeTop && 'app-content-safe-top',
          className,
        )}
      >
        <EnableNotificationsBanner />
        {children}
      </main>
      <NavigatorBackButton />
      {showCart && <FloatingCartBar />}
      {showNav && <BottomNav />}
    </div>
  );
}
