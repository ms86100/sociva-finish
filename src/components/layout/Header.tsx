// @ts-nocheck
import { useState, useCallback, useMemo, memo } from 'react';
import { Bell, MapPin, ChevronDown, Search } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { TypewriterPlaceholder } from '@/components/search/TypewriterPlaceholder';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';
import { BackButton } from '@/components/navigation/BackButton';
import { shouldShowHeaderBack } from '@/lib/navigation-stack';

import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { LocationSelectorSheet } from '@/components/location/LocationSelectorSheet';
import { useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import { formatLocationDisplay } from '@/lib/location-label-resolver';

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
  const location = useLocation();
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const navigateImmediately = useImmediateNavigate('Header');
  const showBackButton = title && shouldShowHeaderBack(location.pathname, showBack);

  const handleRouteNav = useCallback((to: string) => {
    navigateImmediately(to);
  }, [navigateImmediately]);

  const { profile, society, user, viewAsSocietyId, effectiveSociety, effectiveSocietyId, setViewAsSociety, isAdmin, isBuilderMember, isProfileLoading } = useAuth();
  const unreadCount = useUnreadNotificationCount();
  const { browsingLocation } = useBrowsingLocation();
  const takeover = useFestivalTakeover();
  const festivalChrome = takeover.active && !title;

  const displaySociety = effectiveSociety || society;
  const isViewingAs = viewAsSocietyId && (isAdmin || isBuilderMember);

  const initials = profile?.name
    ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : null;

  const rawLocationLabel =
    browsingLocation?.label ||
    displaySociety?.name ||
    (profile?.flat_number
      ? [profile.block, profile.flat_number].filter(Boolean).join(' · ')
      : null) ||
    'Set location';

  const fullAddress = browsingLocation?.fullAddress || displaySociety?.address || profile?.full_address;
  const locationDisplay = useMemo(
    () => formatLocationDisplay(rawLocationLabel, { fullAddress }),
    [rawLocationLabel, fullAddress]
  );

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40',
          festivalChrome
            ? 'border-b border-white/10'
            : 'bg-[hsl(var(--header-bg))] border-b border-border/50',
          !IS_NATIVE && !festivalChrome && 'backdrop-blur-xl',
          className
        )}
        style={festivalChrome ? { backgroundColor: takeover.bg } : undefined}
        data-festival-takeover={festivalChrome ? 'true' : undefined}
      >
        <div
          className="px-4 pb-2.5 space-y-2.5"
          style={{ paddingTop: 'calc(var(--app-safe-top, 28px) + 8px)' }}
        >
          {title ? (
            <div className="flex items-center gap-3 min-h-[44px]">
              {showBackButton ? (
                <BackButton className="bg-muted/80 hover:bg-muted" />
              ) : (
                <span className="w-10 shrink-0" aria-hidden />
              )}
              <span className="text-base font-bold text-foreground truncate flex-1 min-w-0">{title}</span>
            </div>
          ) : (
            <>
              {/* Row 1: Location (primary) + bell + avatar */}
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setLocationSheetOpen(true)}
                  className="min-w-0 flex-1 text-left active:opacity-80 transition-opacity pr-1"
                >
                  <p className={cn(
                    'text-[10px] font-bold uppercase tracking-wider leading-none mb-1',
                    festivalChrome ? 'text-white/70' : 'text-muted-foreground'
                  )}>
                    Delivering to
                  </p>
                  <div className="flex items-center gap-1 min-w-0">
                    <MapPin
                      size={15}
                      className={cn('shrink-0', festivalChrome ? 'text-white' : 'text-primary')}
                      style={festivalChrome ? { color: takeover.accent } : undefined}
                      strokeWidth={2.5}
                    />
                    <span className={cn(
                      'text-[15px] font-extrabold truncate max-w-[210px] sm:max-w-[320px]',
                      festivalChrome ? 'text-white' : 'text-foreground'
                    )}>
                      {locationDisplay.primary}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('shrink-0', festivalChrome ? 'text-white' : 'text-foreground')}
                      strokeWidth={2.5}
                    />
                  </div>
                  {locationDisplay.secondary && (
                    <p className={cn(
                      'text-[11px] truncate leading-tight mt-0.5 pl-[19px] max-w-[230px] sm:max-w-[340px]',
                      festivalChrome ? 'text-white/80' : 'text-muted-foreground'
                    )}>
                      {locationDisplay.secondary}
                    </p>
                  )}
                </button>

                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {user && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'relative h-9 w-9 rounded-full',
                          festivalChrome && 'text-white hover:bg-white/10 hover:text-white'
                        )}
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
                <div className={cn(
                  'flex items-center gap-3 border px-3.5 shadow-sm',
                  festivalChrome
                    ? 'festival-takeover-search rounded-full py-3 border-white/30'
                    : 'bg-secondary border-border rounded-xl py-2.5'
                )}>
                  <Search
                    size={18}
                    className={cn('shrink-0', festivalChrome ? 'text-white/85' : 'text-primary')}
                    strokeWidth={2.25}
                  />
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
