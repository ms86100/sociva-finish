// @ts-nocheck
import { useState, useCallback, memo } from 'react';
import { ArrowLeft, Bell, MapPin, ChevronDown, Search } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { TypewriterPlaceholder } from '@/components/search/TypewriterPlaceholder';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';

import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { LocationSelectorSheet } from '@/components/location/LocationSelectorSheet';

const IS_NATIVE = Capacitor.isNativePlatform();

interface HeaderProps {
  showCart?: boolean;
  showLocation?: boolean;
  title?: string;
  showBack?: boolean;
  className?: string;
}

/**
 * Blinkit-style header: location first, sticky search, minimal chrome.
 * Role shortcuts (admin/seller/builder) live in Profile — keeps marketplace focused.
 */
function HeaderInner({
  title,
  showBack,
  className,
}: HeaderProps) {
  const navigate = useNavigate();
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const navigateImmediately = useImmediateNavigate('Header');

  const handleBack = useCallback(() => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/society');
    }
  }, [navigate]);

  const handleRouteNav = useCallback((to: string) => {
    navigateImmediately(to);
  }, [navigateImmediately]);

  const { profile, society, user, viewAsSocietyId, effectiveSociety, setViewAsSociety, isAdmin, isBuilderMember, isProfileLoading } = useAuth();
  const unreadCount = useUnreadNotificationCount();
  const { browsingLocation } = useBrowsingLocation();

  const displaySociety = effectiveSociety || society;
  const isViewingAs = viewAsSocietyId && (isAdmin || isBuilderMember);

  const initials = profile?.name
    ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : null;

  const locationLabel =
    browsingLocation?.label ||
    displaySociety?.name ||
    (profile?.flat_number
      ? [profile.block, profile.flat_number].filter(Boolean).join(' · ')
      : null) ||
    'Set location';

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 bg-[hsl(var(--header-bg))] border-b border-border/50',
          !IS_NATIVE && 'backdrop-blur-xl',
          className
        )}
      >
        <div
          className="px-4 pb-2.5 space-y-2.5"
          style={{ paddingTop: 'calc(var(--app-safe-top, 28px) + 8px)' }}
        >
          {title ? (
            <div className="flex items-center gap-2 min-h-[44px]">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full shrink-0"
                onClick={handleBack}
              >
                <ArrowLeft size={20} />
              </Button>
              <span className="text-base font-bold text-foreground truncate">{title}</span>
            </div>
          ) : (
            <>
              {/* Row 1: Location (primary) + bell + avatar */}
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setLocationSheetOpen(true)}
                  className="min-w-0 flex-1 text-left active:opacity-80 transition-opacity"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-1">
                    Delivering to
                  </p>
                  <div className="flex items-center gap-1 min-w-0">
                    <MapPin size={15} className="text-primary shrink-0" strokeWidth={2.5} />
                    <span className="text-[15px] font-extrabold text-foreground truncate">
                      {locationLabel}
                    </span>
                    <ChevronDown size={14} className="text-foreground shrink-0" strokeWidth={2.5} />
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {user && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative h-9 w-9 rounded-full"
                        onClick={() => handleRouteNav('/notifications/inbox')}
                        aria-label="Notifications"
                      >
                        <Bell size={18} />
                        {unreadCount > 0 && (
                          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleRouteNav('/profile')}
                        className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold overflow-hidden"
                        aria-label="Open profile"
                      >
                        {isProfileLoading && !profile ? (
                          <span className="h-full w-full animate-pulse bg-primary-foreground/20" />
                        ) : (
                          initials || '?'
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Search */}
              <button
                type="button"
                onClick={() => handleRouteNav('/search')}
                className="block w-full text-left"
              >
                <div className="flex items-center gap-3 bg-secondary border border-border rounded-xl px-3.5 py-2.5 shadow-sm">
                  <Search size={18} className="text-primary shrink-0" strokeWidth={2.25} />
                  <div className="flex-1 min-w-0">
                    <TypewriterPlaceholder context="home" />
                  </div>
                </div>
              </button>
            </>
          )}
        </div>

        <LocationSelectorSheet open={locationSheetOpen} onOpenChange={setLocationSheetOpen} />
      </header>

      {isViewingAs && (
        <div className="sticky top-[120px] z-39 bg-warning/10 border-b border-warning/20 px-4 py-2 flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">
            Viewing: <span className="font-bold">{effectiveSociety?.name}</span>
          </p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewAsSociety(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </Button>
        </div>
      )}
    </>
  );
}

export const Header = memo(HeaderInner);
