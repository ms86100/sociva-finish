// @ts-nocheck
import { memo, useCallback } from 'react';
import { Home, Building2, ShoppingCart, User, Shield, ClipboardList, Briefcase, ListChecks, PackageSearch } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useCartCount } from '@/hooks/useCartCount';
import { useAuth } from '@/contexts/AuthContext';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';
import type { FeatureKey } from '@/hooks/useEffectiveFeatures';

const IS_NATIVE = Capacitor.isNativePlatform();

const residentNavItems: { to: string; icon: typeof Home; label: string; featureKey?: FeatureKey; badge?: string }[] = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/orders', icon: PackageSearch, label: 'Orders' },
  { to: '/cart', icon: ShoppingCart, label: 'Cart', badge: 'cart' },
  { to: '/society', icon: Building2, label: 'Society' },
  { to: '/profile', icon: User, label: 'Account' },
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
  const { features, isFeatureEnabled, isLoading } = useEffectiveFeatures();
  const { isAdmin, isSocietyAdmin, isBuilderMember, isSecurityOfficer, isWorker } = useAuth();
  const itemCount = useCartCount();
  const navigateImmediately = useImmediateNavigate('BottomNav');

  const handleNav = useCallback((to: string) => {
    if (location.pathname === to) return;
    hapticSelection();
    navigateImmediately(to);
  }, [location.pathname, navigateImmediately]);

  const isPrimaryRoleUser = isAdmin || isSocietyAdmin || isBuilderMember;
  const navItems = !isPrimaryRoleUser && isSecurityOfficer
    ? securityNavItems
    : !isPrimaryRoleUser && isWorker
      ? workerNavItems
      : residentNavItems;

  const hasAnyFeature = features.some(f => f.is_enabled && f.society_configurable);

  const visibleItems = isLoading
    ? navItems
    : navItems.filter(item => {
        if (item.to === '/society' && !hasAnyFeature && !isAdmin) return false;
        if ('featureKey' in item && item.featureKey) return isFeatureEnabled((item as any).featureKey);
        return true;
      });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/20"
      style={{ paddingBottom: 'var(--app-safe-bottom)' }}
    >
      {/* Solid fill on native — backdrop-blur tanks Android WebView scroll/nav FPS */}
      <div className={cn(
        'absolute inset-0 bg-background',
        !IS_NATIVE && 'bg-background/70 backdrop-blur-2xl backdrop-saturate-150',
      )} />

      <div className="relative flex items-center justify-around px-1 h-16">
        {visibleItems.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to ||
            (to !== '/' && location.pathname.startsWith(to));
          const showCartBadge = to === '/cart' && itemCount > 0 && location.pathname !== '/cart';

          return (
            <button
              key={to}
              type="button"
              onClick={() => handleNav(to)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-2xl min-w-[52px] relative active:scale-95 transition-transform',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className="relative flex items-center justify-center w-11 h-8 rounded-full">
                {isActive && (
                  <div className="absolute inset-0 rounded-full bg-primary/15" />
                )}
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.4 : 1.7}
                  className="relative z-10"
                />
                {showCartBadge && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center shadow-sm z-10">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </div>
              <span className={cn(
                'text-[10px] leading-none',
                isActive ? 'font-bold' : 'font-medium'
              )}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const BottomNav = memo(BottomNavInner);
