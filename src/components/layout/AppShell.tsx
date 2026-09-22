// @ts-nocheck
import { useEffect, useState } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { FloatingCartBar } from '@/components/cart/FloatingCartBar';
import { NavigatorBackButton } from '@/components/admin/NavigatorBackButton';
import { EnableNotificationsBanner } from '@/components/notifications/EnableNotificationsBanner';
import { PostLoginPermissionSheet } from '@/components/permissions/PostLoginPermissionSheet';
import { NavigationStackTracker } from '@/components/navigation/NavigationStackTracker';
import {
  AppLayoutShellProvider,
  useAppLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/contexts/AppLayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { cn } from '@/lib/utils';
import { isGuestBrowsePath, authReturnPath } from '@/lib/guest-browse-routes';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';
import { needsLocationOnboarding } from '@/lib/location-onboarding';

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
      <NavigationStackTracker />
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
        <PostLoginPermissionSheet />
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
 * Gate for shell routes.
 * - Guests may browse discovery paths (App Store 5.1.1(v)).
 * - Authenticated users without society keep today's /profile/edit redirect.
 * - Native never opens the marketing landing site.
 */
export function AppShellGate() {
  const { user, profile, isSessionRestored } = useAuth();
  const location = useLocation();
  const { browsingLocation } = useBrowsingLocation();
  const [bootGaveUp, setBootGaveUp] = useState(false);

  useEffect(() => {
    if (isSessionRestored) return;
    const t = setTimeout(() => setBootGaveUp(true), 7000);
    return () => clearTimeout(t);
  }, [isSessionRestored]);

  if (!isSessionRestored && !bootGaveUp) {
    return null;
  }

  const path = location.pathname || '/';
  const guestOk = isGuestBrowsePath(path);

  if (!user) {
    // Swiggy-style: web guests stay in marketplace (location → Home), not marketing landing.
    // Marketing site remains at /landing for explicit links only.

    if (!guestOk) {
      const returnTo = authReturnPath(path, location.search || '');
      return <Navigate to="/auth" replace state={{ from: returnTo, returnTo }} />;
    }

    const hasCoords = hasPreciseCoordinates(browsingLocation?.lat, browsingLocation?.lng);
    if (
      path !== '/discover-location' &&
      needsLocationOnboarding(hasCoords)
    ) {
      return <Navigate to="/discover-location" replace />;
    }

    return <AppShell />;
  }

  // Authenticated: preserve existing society onboarding (zero intentional change).
  if (profile && !profile.society_id && path !== '/profile/edit') {
    return <Navigate to="/profile/edit" replace />;
  }

  return <AppShell />;
}
