import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isExitRoot,
  isTabRootPath,
  planBackNavigation,
  recordNavigationPath,
  resetNavigationStackForTests,
  resolveBackFallback,
  shouldShowHeaderBack,
} from '@/lib/navigation-stack';
import { shouldShowFloatingCartBar } from '@/lib/visibilityEngine';

const auth = vi.hoisted(() => ({
  value: {
    user: null as null | { id: string },
    isAdmin: false,
    isSocietyAdmin: false,
    isBuilderMember: false,
    isSecurityOfficer: false,
    isWorker: false,
  },
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/hooks/useEffectiveFeatures', () => ({ useEffectiveFeatures: () => ({ isFeatureEnabled: () => true }) }));
vi.mock('@/hooks/useImmediateNavigate', () => ({ useImmediateNavigate: () => navigate }));
vi.mock('@/lib/haptics', () => ({ hapticSelection: () => {} }));

import { BottomNav } from '@/components/layout/BottomNav';

function renderNav(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

const labels = () => screen.getAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  navigate.mockReset();
  auth.value = {
    user: null,
    isAdmin: false,
    isSocietyAdmin: false,
    isBuilderMember: false,
    isSecurityOfficer: false,
    isWorker: false,
  };
  resetNavigationStackForTests();
});

describe('resident bottom nav: Home, Book, Contact, Orders, Account', () => {
  it('renders the five tabs and no Cart or Society tab', () => {
    auth.value.user = { id: 'u1' };
    renderNav('/');
    expect(labels()).toEqual(['Home', 'Book', 'Contact', 'Orders', 'Account']);
  });

  it('shows guests Sign in in the Account slot', () => {
    renderNav('/');
    expect(labels()).toEqual(['Home', 'Book', 'Contact', 'Orders', 'Sign in']);
  });

  it('lets guests open Book without signing in', () => {
    renderNav('/');
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(navigate).toHaveBeenCalledWith('/book', { replace: true });
  });

  it('sends guests to sign-in for Account and Orders', () => {
    renderNav('/');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(navigate).toHaveBeenCalledWith('/auth', { state: { from: '/profile', returnTo: '/profile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    expect(navigate).toHaveBeenCalledWith('/auth', { state: { from: '/orders', returnTo: '/orders' } });
  });

  it('replaces between tabs but pushes from a non-tab page', () => {
    auth.value.user = { id: 'u1' };
    const { unmount } = renderNav('/book');
    fireEvent.click(screen.getByRole('button', { name: 'Contact' }));
    expect(navigate).toHaveBeenLastCalledWith('/services', { replace: true });
    unmount();
    renderNav('/cart');
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(navigate).toHaveBeenLastCalledWith('/profile', { replace: false });
  });

  it('marks only the current tab active', () => {
    renderNav('/book');
    expect(screen.getByRole('button', { name: 'Book' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
});

describe('role nav variants are unchanged', () => {
  it('security officers keep Kiosk, History, Profile', () => {
    auth.value = { ...auth.value, user: { id: 'g1' }, isSecurityOfficer: true };
    renderNav('/guard-kiosk');
    expect(labels()).toEqual(['Kiosk', 'History', 'Profile']);
  });

  it('workers keep Jobs, My Jobs, Profile', () => {
    auth.value = { ...auth.value, user: { id: 'w1' }, isWorker: true };
    renderNav('/worker/jobs');
    expect(labels()).toEqual(['Jobs', 'My Jobs', 'Profile']);
  });
});

describe('back navigation with mode tabs', () => {
  it('mode tabs are tab roots; Cart and Society are back-able pages', () => {
    for (const path of ['/', '/profile', '/book', '/services', '/orders']) {
      expect(isTabRootPath(path), path).toBe(true);
    }
    expect(isTabRootPath('/shop')).toBe(false);
    for (const path of ['/cart', '/society']) {
      expect(isTabRootPath(path), path).toBe(false);
      expect(shouldShowHeaderBack(path), path).toBe(true);
      expect(resolveBackFallback(path), path).toBe('/');
    }
    expect(shouldShowHeaderBack('/profile')).toBe(false);
  });

  it('Back from a mode tab returns Home, and only Home exits the app', () => {
    recordNavigationPath('/', 'REPLACE');
    recordNavigationPath('/book', 'REPLACE');
    expect(planBackNavigation('/book')).toEqual({ type: 'replace', to: '/' });
    expect(isExitRoot('/book')).toBe(false);
    expect(isExitRoot('/')).toBe(true);
  });

  it('Back from Cart opened on a mode tab returns to that tab', () => {
    recordNavigationPath('/', 'REPLACE');
    recordNavigationPath('/book', 'REPLACE');
    recordNavigationPath('/cart', 'PUSH');
    expect(planBackNavigation('/cart')).toEqual({ type: 'history' });
  });

  it('Society page has its own Back button now that it is not a tab', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/SocietyDashboardPage.tsx'), 'utf8');
    expect(src).toMatch(/<BackButton fallback="\/" \/>/);
  });
});

describe('cart stays single and reachable', () => {
  it('floating cart bar shows on mode tabs and nowhere new', () => {
    for (const path of ['/', '/book', '/services']) {
      expect(shouldShowFloatingCartBar(path, 1), path).toBe(true);
      expect(shouldShowFloatingCartBar(path, 0), path).toBe(false);
    }
    expect(shouldShowFloatingCartBar('/shopping', 1)).toBe(false);
    expect(shouldShowFloatingCartBar('/cart', 1)).toBe(false);
  });

  it('bottom nav no longer carries a cart badge; the header does', () => {
    const nav = readFileSync(resolve(process.cwd(), 'src/components/layout/BottomNav.tsx'), 'utf8');
    const header = readFileSync(resolve(process.cwd(), 'src/components/layout/Header.tsx'), 'utf8');
    expect(nav).not.toMatch(/useCartCount/);
    expect(header).toMatch(/data-testid="header-cart-badge"/);
  });
});
