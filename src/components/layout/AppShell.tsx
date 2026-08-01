// @ts-nocheck
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

      <main className={cn('pb-24', options.className)}>
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
  const { user, isLoading, isSessionRestored } = useAuth();
  const location = useLocation();

  if (isLoading || !isSessionRestored) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!user) {
    const to = location.pathname === '/' ? '/landing' : '/auth';
    return <Navigate to={to} replace />;
  }

  return <AppShell />;
}
