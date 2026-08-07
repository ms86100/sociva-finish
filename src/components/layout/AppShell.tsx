// @ts-nocheck
import { useEffect, useState } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { FloatingCartBar } from '@/components/cart/FloatingCartBar';
import { NavigatorBackButton } from '@/components/admin/NavigatorBackButton';
import { EnableNotificationsBanner } from '@/components/notifications/EnableNotificationsBanner';
import {
  AppLayoutShellProvider,
  useAppLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/contexts/AppLayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/**
 * Persistent chrome shell. Header / BottomNav stay mounted across route changes.
 * Pages still render <AppLayout {...}> which only updates options (passthrough).
 */
function AppShellChrome() {
  const options = useAppLayoutOptions() || DEFAULT_LAYOUT_OPTIONS;
  const showHeader = options.showHeader !== false;
  const showNav = options.showNav !== false;
  const showCart = options.showCart !== false;
  const safeTop = options.safeTop ?? !showHeader;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className={cn(!showHeader && 'hidden')}>
        <Header
          showCart={showCart}
          showLocation={options.showLocation !== false}
          showBack={options.showBack}
          title={options.headerTitle}
        />
      </div>

      <main
        className={cn(
          'pb-24',
          safeTop && 'app-content-safe-top',
          options.className,
        )}
      >
        <EnableNotificationsBanner />
        <Outlet />
      </main>

      <NavigatorBackButton />

      <div className={cn(!showCart && 'hidden')}>
        <FloatingCartBar />
      </div>

      <div className={cn(!showNav && 'hidden')}>
        <BottomNav />
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <AppLayoutShellProvider>
      <AppShellChrome />
    </AppLayoutShellProvider>
  );
}

/**
 * Auth gate that renders the persistent shell for all nested protected routes.
 * `/` → landing when logged out; other paths → /auth.
 */
export function AppShellGate() {
  const { user, isSessionRestored } = useAuth();
  const location = useLocation();
  const [bootGaveUp, setBootGaveUp] = useState(false);

  // Session restore only — profile/society loading must not replace Home with a spinner
  // after SplashGate (that felt like a second black/blank screen).
  useEffect(() => {
    if (isSessionRestored) return;
    const t = setTimeout(() => setBootGaveUp(true), 7000);
    return () => clearTimeout(t);
  }, [isSessionRestored]);

  if (!isSessionRestored && !bootGaveUp) {
    return null;
  }

  if (!user) {
    const to = location.pathname === '/' ? '/landing' : '/auth';
    return <Navigate to={to} replace />;
  }

  return <AppShell />;
}
