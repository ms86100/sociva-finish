import { NavLink, useLocation } from 'react-router-dom';
import { CarFront, Home, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  {
    id: 'home',
    to: '/cleaner-city',
    end: true,
    label: 'Home',
    icon: Home,
    match: (path: string) =>
      path === '/cleaner-city' || path.startsWith('/cleaner-city/discover'),
  },
  {
    id: 'find',
    to: '/cleaner-city/find',
    label: 'Find',
    icon: Search,
    match: (path: string) =>
      path.startsWith('/cleaner-city/find') || path.startsWith('/cleaner-city/offer'),
  },
  {
    id: 'rides',
    to: '/cleaner-city/rides',
    label: 'My rides',
    icon: CarFront,
    match: (path: string) =>
      path.startsWith('/cleaner-city/rides') || path.startsWith('/cleaner-city/ride/'),
  },
  {
    id: 'profile',
    to: '/cleaner-city/profile',
    label: 'Profile',
    icon: UserRound,
    match: (path: string) =>
      path.startsWith('/cleaner-city/profile') ||
      path.startsWith('/cleaner-city/setup') ||
      path.startsWith('/cleaner-city/schedule') ||
      path.startsWith('/cleaner-city/vehicle') ||
      path.startsWith('/cleaner-city/route') ||
      path.startsWith('/cleaner-city/circles') ||
      path.startsWith('/cleaner-city/safety') ||
      path.startsWith('/cleaner-city/chat'),
  },
] as const;

/**
 * Cleaner City IA: Home · Find · My rides · Profile.
 * Offer a seat is reached from Home / Find empty states, not a fifth tab.
 */
export function CleanerCityBottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-black/5 bg-[#F7F5F1]/95 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur-md"
      data-testid="cleaner-city-bottom-nav"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-0.5 px-1.5 pt-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.match(pathname);
          return (
            <NavLink
              key={tab.id}
              to={tab.to}
              end={'end' in tab ? tab.end : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold transition active:scale-[0.97]',
                active ? 'text-[#0F3D2E]' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2.5 : 2.1} />
              {tab.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
