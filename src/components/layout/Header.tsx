// @ts-nocheck
import { useState, useCallback, useMemo, memo, useRef, useLayoutEffect, useEffect, lazy, Suspense } from 'react';
import { Bell, MapPin, ChevronDown, Search, ShoppingCart, X } from 'lucide-react';

import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { TypewriterPlaceholder } from '@/components/search/TypewriterPlaceholder';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { useImmediateNavigate } from '@/hooks/useImmediateNavigate';
import { BackButton } from '@/components/navigation/BackButton';
import { shouldShowHeaderBack } from '@/lib/navigation-stack';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import { useCartCount } from '@/hooks/useCartCount';
import { useCart } from '@/hooks/useCart';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { LocationSelectorSheet } from '@/components/location/LocationSelectorSheet';
import { useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import { formatLocationDisplay } from '@/lib/location-label-resolver';
import { useHomeSearch } from '@/contexts/HomeSearchContext';

/** Home header green from the Sociva marketplace mockup. */
const HOME_HEADER_GREEN = '#1A5C3A';

interface HeaderProps {
  showCart?: boolean;
  showLocation?: boolean;
  title?: string;
  showBack?: boolean;
  className?: string;
}

/**
 * Blinkit-style header: location first, sticky search, minimal chrome.
 * Role shortcuts (admin/seller/builder) live in Profile - keeps marketplace focused.
 */
function HeaderInner({
  showCart = true,
  title,
  showBack,
  className,
}: HeaderProps) {
  const location = useLocation();
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const { query: homeQuery, setQuery: setHomeQuery } = useHomeSearch();
  const homeSearchRef = useRef<HTMLInputElement | null>(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const navigateImmediately = useImmediateNavigate('Header');
  const showBackButton = title && shouldShowHeaderBack(location.pathname, showBack);

  const handleRouteNav = useCallback((to: string) => {
    navigateImmediately(to);
  }, [navigateImmediately]);

  const { profile, society, user, viewAsSocietyId, effectiveSociety, effectiveSocietyId, setViewAsSociety, isAdmin, isBuilderMember, isProfileLoading } = useAuth();
  const unreadCount = useUnreadNotificationCount();
  const countFromQuery = useCartCount();
  const { itemCount: countFromCart, isRecoveringCart } = useCart();
  // Prefer live cart lines; while recovering a JOIN miss, keep the count query so the
  // badge never flashes 0 then 1 after a seller-dashboard round trip.
  const cartCount = isRecoveringCart
    ? Math.max(countFromCart, countFromQuery)
    : (countFromCart > 0 ? countFromCart : countFromQuery);
  const showCartButton = showCart && location.pathname !== '/cart';
  const { browsingLocation, hasOverride } = useBrowsingLocation();
  const takeover = useFestivalTakeover();
  const festivalChrome = takeover.active && !title;
  const marketplaceChrome = !title && !festivalChrome && (location.pathname === '/' || location.pathname === '');

  useEffect(() => {
    if (!marketplaceChrome && !festivalChrome) {
      setHomeQuery('');
      setDetailOpen(false);
    }
  }, [marketplaceChrome, festivalChrome]);


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

  const fullAddress = browsingLocation?.fullAddress
    || (!hasOverride ? (displaySociety?.address || (profile as { full_address?: string } | null)?.full_address) : undefined);
  const locationDisplay = useMemo(
    () => formatLocationDisplay(rawLocationLabel, { fullAddress }),
    [rawLocationLabel, fullAddress]
  );

  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      const height = Math.ceil(Math.max(el.offsetHeight, el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--app-header-offset', `${height}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!marketplaceChrome) {
      document.documentElement.style.removeProperty('--app-status-chrome');
      return;
    }
    document.documentElement.style.setProperty('--app-status-chrome', HOME_HEADER_GREEN);
    return () => {
      document.documentElement.style.removeProperty('--app-status-chrome');
    };
  }, [marketplaceChrome]);

  return (
    <>
      <header
        ref={headerRef}
        className={cn(
          'relative z-40 isolate overflow-visible',
          festivalChrome
            ? 'border-b border-white/10'
            : marketplaceChrome
              ? 'border-b-0 bg-background'
              : 'bg-[hsl(var(--header-bg))] border-b border-border/40',
          className
        )}
        style={
          festivalChrome
            ? { backgroundColor: takeover.bg }
            : undefined
        }
        data-festival-takeover={festivalChrome ? 'true' : undefined}
        data-testid={marketplaceChrome ? 'home-marketplace-header' : undefined}
      >
        <div
          className={cn(
            marketplaceChrome && 'rounded-b-[2.5rem] shadow-[0_8px_22px_-16px_rgba(0,0,0,0.35)]',
          )}
          style={marketplaceChrome ? { backgroundColor: HOME_HEADER_GREEN } : undefined}
        >
        <div
          className={cn('px-4 space-y-2.5', marketplaceChrome ? 'pb-4' : 'pb-3')}
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
              {/* Row 1: Brand + location + actions */}
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setLocationSheetOpen(true)}
                  className="min-w-0 flex-1 text-left active:opacity-80 transition-opacity pr-1"
                  aria-label={user ? `Change location, ${locationDisplay.primary}` : `Available near you, ${locationDisplay.primary}`}
                >
                  {!marketplaceChrome && (
                    <p className={cn(
                      'text-[10px] font-bold uppercase tracking-wider leading-none mb-1',
                      festivalChrome ? 'text-white/70' : 'text-muted-foreground'
                    )}>
                      {user ? 'Delivering to' : 'Available near you'}
                    </p>
                  )}
                  <div className="flex items-center gap-1 min-w-0">
                    <MapPin
                      size={marketplaceChrome ? 16 : 15}
                      className={cn('shrink-0', (festivalChrome || marketplaceChrome) ? 'text-white' : 'text-primary')}
                      style={festivalChrome ? { color: takeover.accent } : undefined}
                      strokeWidth={2.5}
                    />
                    <span className={cn(
                      'font-extrabold truncate max-w-[210px] sm:max-w-[320px]',
                      marketplaceChrome ? 'text-[18px] text-white' : 'text-[15px]',
                      !marketplaceChrome && (festivalChrome ? 'text-white' : 'text-foreground')
                    )}>
                      {marketplaceChrome ? 'Sociva' : locationDisplay.primary}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('shrink-0', (festivalChrome || marketplaceChrome) ? 'text-white' : 'text-foreground')}
                      strokeWidth={2.5}
                    />
                  </div>
                  {(marketplaceChrome || locationDisplay.secondary) && (
                    <p className={cn(
                      'truncate leading-tight mt-0.5 pl-[19px] max-w-[230px] sm:max-w-[340px]',
                      marketplaceChrome ? 'text-[12px] text-white/85' : 'text-[11px]',
                      !marketplaceChrome && (festivalChrome ? 'text-white/80' : 'text-muted-foreground')
                    )}>
                      {marketplaceChrome
                        ? (displaySociety?.name || locationDisplay.primary)
                        : locationDisplay.secondary}
                    </p>
                  )}
                </button>

                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {showCartButton && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'relative h-9 w-9 rounded-full',
                        (festivalChrome || marketplaceChrome) && 'text-white hover:bg-white/10 hover:text-white'
                      )}
                      onClick={() => handleRouteNav('/cart')}
                      aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart'}
                      data-testid="header-cart"
                    >
                      <ShoppingCart size={18} />
                      {cartCount > 0 && (
                        <span
                          className={cn(
                            'absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2',
                            marketplaceChrome ? 'ring-[#1A5C3A]' : 'ring-background',
                          )}
                          data-testid="header-cart-badge"
                        >
                          {cartCount > 9 ? '9+' : cartCount}
                        </span>
                      )}
                    </Button>
                  )}
                  {!user ? (
                    <Button
                      variant={festivalChrome || marketplaceChrome ? 'ghost' : 'default'}
                      size="sm"
                      className={cn(
                        'h-9 rounded-full px-3.5 text-[13px] font-bold',
                        (festivalChrome || marketplaceChrome) && 'text-white hover:bg-white/10 hover:text-white border border-white/30'
                      )}
                      onClick={() => handleRouteNav('/auth')}
                    >
                      Sign in
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'relative h-9 w-9 rounded-full',
                          (festivalChrome || marketplaceChrome) && 'text-white hover:bg-white/10 hover:text-white'
                        )}
                        onClick={() => handleRouteNav('/notifications/inbox')}
                        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                        data-testid="header-notifications"
                      >
                        <Bell size={18} />
                        {unreadCount > 0 && (
                          <span
                            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground tabular-nums"
                            data-testid="header-notifications-badge"
                          >
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleRouteNav('/profile')}
                        className={cn(
                          'h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold overflow-hidden shadow-sm ring-2',
                          marketplaceChrome ? 'ring-white/35' : 'ring-background',
                        )}
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

              {/* Row 2: Search - inline autocomplete, same dropdown as Book/Contact */}
              <div className="relative z-50 overflow-visible">
                <label className="relative block">
                  <Search
                    size={18}
                    className={cn(
                      'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2',
                      festivalChrome ? 'text-white/85' : 'text-primary',
                    )}
                    strokeWidth={2.25}
                  />
                  {!homeQuery && (
                    <div className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 pr-10 overflow-hidden whitespace-nowrap max-w-[calc(100%-4rem)]">
                      <TypewriterPlaceholder context="home" />
                    </div>
                  )}
                  <input
                    ref={homeSearchRef}
                    type="text"
                    value={homeQuery}
                    onChange={(event) => setHomeQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && homeQuery.trim() && !event.defaultPrevented) {
                        homeSearchRef.current?.blur();
                        handleRouteNav(`/search?q=${encodeURIComponent(homeQuery.trim())}`);
                      }
                    }}
                    placeholder=""
                    data-testid="home-header-search"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    inputMode="search"
                    aria-label="Search Sociva"
                    className={cn(
                      'w-full border pl-10 pr-9 shadow-sm outline-none text-[14px]',
                      festivalChrome
                        ? 'festival-takeover-search rounded-full py-3 border-white/30 bg-transparent text-white'
                        : marketplaceChrome
                          ? 'bg-white border-white rounded-full py-3 text-foreground'
                          : 'bg-[hsl(var(--search-bg))] border-[hsl(var(--search-border))] rounded-xl py-2.5 text-foreground hover:border-border/70',
                    )}
                  />
                  {homeQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setHomeQuery('')}
                      className={cn(
                        'absolute right-3 top-1/2 -translate-y-1/2',
                        festivalChrome ? 'text-white/80 hover:text-white' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <X size={14} />
                    </button>
                  )}
                  <SearchAutocomplete
                    query={homeQuery}
                    inputRef={homeSearchRef}
                    maxHeight={220}
                    onDismiss={() => {
                      homeSearchRef.current?.blur();
                    }}
                    onSelect={(product) => {
                      homeSearchRef.current?.blur();
                      setSelectedProduct(product);
                      setDetailOpen(true);
                    }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
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

      {detailOpen && (
        <Suspense fallback={null}>
          <ProductDetailSheet
            product={selectedProduct}
            open={detailOpen}
            onOpenChange={setDetailOpen}
            onSelectProduct={(sp) => {
              setSelectedProduct({
                product_id: sp.id,
                product_name: sp.name,
                price: sp.price,
                image_url: sp.image_url,
                is_veg: sp.is_veg,
                category: sp.category,
                description: sp.description || null,
                seller_id: sp.seller_id,
                seller_name: sp.seller?.business_name || '',
                seller_rating: 0,
                seller_reviews: 0,
                action_type: sp.action_type,
              });
            }}
          />
        </Suspense>
      )}
    </>
  );
}

export const Header = memo(HeaderInner);
