// @ts-nocheck
import { memo, useCallback } from 'react';
import { Home, ShoppingBag, CalendarCheck, Wrench, User, Shield, ClipboardList, Briefcase, ListChecks, PackageSearch } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useAuth } from '@/contexts/AuthContext';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';
import type { FeatureKey } from '@/hooks/useEffectiveFeatures';
import { authReturnPath } from '@/lib/guest-browse-routes';
import { isTabRootPath } from '@/lib/navigation-stack';

const IS_NATIVE = Capacitor.isNativePlatform();

const GUEST_AUTH_ROUTES = new Set(['/orders', '/profile']);

/** Cart lives in the header and floating bar; Account behind the header avatar; Society in Profile. */
const residentNavItems: { to: string; icon: typeof Home; label: string; featureKey?: FeatureKey }[] = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/shop', icon: ShoppingBag, label: 'Shop' },
  { to: '/book', icon: CalendarCheck, label: 'Book' },
  { to: '/services', icon: Wrench, label: 'Services' },
  { to: '/orders', icon: PackageSearch, label: 'Orders' },
];

const securityNavItems: { to: string; icon: typeof Shield; label: string }[] = [
  { to: '/guard-kiosk', icon: Shield, label: 'Kiosk' },
  { to: '/security/audit', icon: ClipboardList, label: 'History' },
  { to: '/profile', icon: User, label: 'Profile' },
];

const workerNavItems: { to: string; icon: typeof Briefcase; label: string }[] = [
  { to: '/worker/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/worker/my-jobs', icon: ListChecks, label: 'My Jobs' },
  { to: '/profile', icon: User, label: 'Profile' },
];

function BottomNavInner() {
  const location = useLocation();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const { user, isAdmin, isSocietyAdmin, isBuilderMember, isSecurityOfficer, isWorker } = useAuth();
  const navigateImmediately = useImmediateNavigate('BottomNav');

  const handleNav = useCallback((to: string) => {
    if (location.pathname === to) return;
    hapticSelection();
    if (!user && GUEST_AUTH_ROUTES.has(to)) {
      const returnTo = authReturnPath(to);
      navigateImmediately('/auth', { state: { from: returnTo, returnTo } });
      return;
    }
    const replaceTabs = isTabRootPath(location.pathname) && isTabRootPath(to);
    navigateImmediately(to, { replace: replaceTabs });
  }, [location.pathname, navigateImmediately, user]);

  const isPrimaryRoleUser = isAdmin || isSocietyAdmin || isBuilderMember;
  const navItems = !isPrimaryRoleUser && isSecurityOfficer
    ? securityNavItems
    : !isPrimaryRoleUser && isWorker
      ? workerNavItems
      : residentNavItems;

  const visibleItems = navItems.filter(item => {
    if ('featureKey' in item && item.featureKey) return isFeatureEnabled((item as any).featureKey);
    return true;
  });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/25"
      style={{ paddingBottom: 'max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Solid fill on native - backdrop-blur tanks Android WebView scroll/nav FPS */}
      <div className={cn(
        'absolute inset-0 bg-background',
        !IS_NATIVE && 'bg-background/78 backdrop-blur-2xl backdrop-saturate-150',
      )} />

      <div className="relative flex items-center justify-around px-1.5 h-16">
        {visibleItems.map(({ to, icon: Icon, label }) => {
          const displayLabel = !user && to === '/profile' ? 'Sign in' : label;
          const isActive = location.pathname === to ||
            (to !== '/' && location.pathname.startsWith(to));

          return (
            <button
              key={to}
              type="button"
              onClick={() => handleNav(to)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 rounded-2xl min-h-[44px] relative active:scale-95 transition-colors duration-150',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className="relative flex items-center justify-center w-11 h-8 rounded-full">
                {isActive && (
                  <div className="absolute inset-0 rounded-full bg-primary/18" />
                )}
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.4 : 1.7}
                  className="relative z-10"
                />
              </div>
              <span className={cn(
                'max-w-full truncate text-[10px] leading-none tracking-wide',
                isActive ? 'font-bold' : 'font-medium'
              )}>
                {displayLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const BottomNav = memo(BottomNavInner);
