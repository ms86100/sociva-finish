import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import {
  __resetPullToRefreshRegistryForTests,
  acquirePullToRefreshBlock,
  applyPullResistance,
  classifyPullMove,
  isBlockingOverlayOpen,
  isEditableElement,
  isPullToRefreshDisabledPath,
  isPullToRefreshHardBlocked,
  PULL_THRESHOLD_PX,
  queryKeyHead,
  refetchCurrentScreen,
  registerScreenRefresh,
  shouldBeginPull,
  shouldRefetchQueryKey,
  STATIC_QUERY_PREFIXES,
} from '@/lib/pull-to-refresh';

describe('pull-to-refresh policy', () => {
  beforeEach(() => {
    __resetPullToRefreshRegistryForTests();
  });

  it('disables pull-to-refresh on auth, onboarding, profile edit, and product forms', () => {
    expect(isPullToRefreshDisabledPath('/auth')).toBe(true);
    expect(isPullToRefreshDisabledPath('/become-seller')).toBe(true);
    expect(isPullToRefreshDisabledPath('/become-seller/resume')).toBe(true);
    expect(isPullToRefreshDisabledPath('/profile/edit')).toBe(true);
    expect(isPullToRefreshDisabledPath('/seller/products/new')).toBe(true);
    expect(isPullToRefreshDisabledPath('/seller/products/abc/edit')).toBe(true);
    expect(isPullToRefreshDisabledPath('/worker-hire/create')).toBe(true);
    expect(isPullToRefreshDisabledPath('/reset-password')).toBe(true);
  });

  it('allows pull-to-refresh on marketplace, cart, orders, search, and dashboards', () => {
    expect(isPullToRefreshDisabledPath('/')).toBe(false);
    expect(isPullToRefreshDisabledPath('/search')).toBe(false);
    expect(isPullToRefreshDisabledPath('/cart')).toBe(false);
    expect(isPullToRefreshDisabledPath('/orders')).toBe(false);
    expect(isPullToRefreshDisabledPath('/orders/xyz')).toBe(false);
    expect(isPullToRefreshDisabledPath('/seller')).toBe(false);
    expect(isPullToRefreshDisabledPath('/seller/products')).toBe(false);
    expect(isPullToRefreshDisabledPath('/seller/abc')).toBe(false);
    expect(isPullToRefreshDisabledPath('/notifications/inbox')).toBe(false);
    expect(isPullToRefreshDisabledPath('/admin')).toBe(false);
    expect(isPullToRefreshDisabledPath('/checkouts/group-1')).toBe(false);
  });

  it('skips static config queries and can skip cart during mutations', () => {
    expect(shouldRefetchQueryKey(['marketplace-sellers'])).toBe(true);
    expect(shouldRefetchQueryKey(['cart-items', 'user-1'])).toBe(true);
    expect(shouldRefetchQueryKey(['orders', 'buying'])).toBe(true);
    expect(shouldRefetchQueryKey(['category-configs'])).toBe(false);
    expect(shouldRefetchQueryKey(['badge-config'])).toBe(false);
    expect(shouldRefetchQueryKey(['parent-groups'])).toBe(false);
    expect(shouldRefetchQueryKey(['cart-items', 'user-1'], { skipCart: true })).toBe(false);
    expect(shouldRefetchQueryKey(['cart-count', 'user-1'], { skipCart: true })).toBe(false);
    expect(STATIC_QUERY_PREFIXES.has('system-settings-all')).toBe(true);
    expect(queryKeyHead(['seller-orders', 's1'])).toBe('seller-orders');
  });

  it('only begins a pull at the top without overlays, blocks, or keyboard-on-input', () => {
    expect(shouldBeginPull({
      overlayOpen: false,
      routeDisabled: false,
      blocked: false,
      keyboardOpen: false,
      startedOnEditable: false,
      atScrollTop: true,
    })).toBe(true);

    expect(shouldBeginPull({
      overlayOpen: false,
      routeDisabled: false,
      blocked: false,
      keyboardOpen: false,
      startedOnEditable: false,
      atScrollTop: false,
    })).toBe(false);

    expect(shouldBeginPull({
      overlayOpen: true,
      routeDisabled: false,
      blocked: false,
      keyboardOpen: false,
      startedOnEditable: false,
      atScrollTop: true,
    })).toBe(false);

    expect(shouldBeginPull({
      overlayOpen: false,
      routeDisabled: true,
      blocked: false,
      keyboardOpen: false,
      startedOnEditable: false,
      atScrollTop: true,
    })).toBe(false);

    expect(shouldBeginPull({
      overlayOpen: false,
      routeDisabled: false,
      blocked: false,
      keyboardOpen: true,
      startedOnEditable: true,
      atScrollTop: true,
    })).toBe(false);

    expect(shouldBeginPull({
      overlayOpen: false,
      routeDisabled: false,
      blocked: false,
      keyboardOpen: true,
      startedOnEditable: false,
      atScrollTop: true,
    })).toBe(true);
  });

  it('does not hijack horizontal swipes or mid-list scrolling', () => {
    expect(classifyPullMove(40, 8)).toBe('cancel-horizontal');
    expect(classifyPullMove(2, -20)).toBe('cancel-up');
    expect(classifyPullMove(4, 30)).toBe('pull');
    expect(applyPullResistance(-10)).toBe(0);
    expect(applyPullResistance(40)).toBeGreaterThan(0);
    expect(applyPullResistance(40)).toBeLessThan(40);
    expect(applyPullResistance(400)).toBeLessThanOrEqual(112);
    expect(PULL_THRESHOLD_PX).toBe(72);
  });

  it('detects dialogs, drawers, checkout, and Razorpay as blocking overlays', () => {
    const root = document.createElement('div');
    expect(isBlockingOverlayOpen(root)).toBe(false);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    root.appendChild(dialog);
    expect(isBlockingOverlayOpen(root)).toBe(true);

    root.innerHTML = '';
    const checkout = document.createElement('div');
    checkout.setAttribute('data-checkout-in-progress', 'true');
    root.appendChild(checkout);
    expect(isBlockingOverlayOpen(root)).toBe(true);

    root.innerHTML = '';
    const razorpay = document.createElement('div');
    razorpay.className = 'razorpay-container';
    root.appendChild(razorpay);
    expect(isBlockingOverlayOpen(root)).toBe(true);
  });

  it('treats text inputs as editable targets', () => {
    const input = document.createElement('input');
    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(document.createElement('div'))).toBe(false);
  });

  it('refetches active non-static queries and registered screen handlers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const refetchQueries = vi.spyOn(client, 'refetchQueries').mockResolvedValue([] as any);
    const screenRefresh = vi.fn().mockResolvedValue(undefined);
    const stop = registerScreenRefresh(screenRefresh);

    const outcome = await refetchCurrentScreen(client, '/');
    expect(outcome.ok).toBe(true);
    expect(screenRefresh).toHaveBeenCalledTimes(1);
    expect(refetchQueries).toHaveBeenCalled();
    const arg = refetchQueries.mock.calls[0][0] as {
      type: string;
      predicate: (query: { queryKey: unknown[] }) => boolean;
    };
    expect(arg.type).toBe('active');
    expect(arg.predicate({ queryKey: ['marketplace-sellers'] })).toBe(true);
    expect(arg.predicate({ queryKey: ['orders'] })).toBe(true);
    expect(arg.predicate({ queryKey: ['category-configs'] })).toBe(false);
    expect(arg.predicate({ queryKey: ['badge-config'] })).toBe(false);

    stop();
    client.clear();
  });

  it('does not run refreshers on disabled routes and respects hard blocks', async () => {
    const client = new QueryClient();
    const screenRefresh = vi.fn();
    registerScreenRefresh(screenRefresh);

    await refetchCurrentScreen(client, '/become-seller');
    expect(screenRefresh).not.toHaveBeenCalled();

    const release = acquirePullToRefreshBlock();
    expect(isPullToRefreshHardBlocked()).toBe(true);
    await refetchCurrentScreen(client, '/');
    expect(screenRefresh).not.toHaveBeenCalled();
    release();
    expect(isPullToRefreshHardBlocked()).toBe(false);
  });

  it('skips cart queries while a mutation is in flight', async () => {
    const client = new QueryClient();
    vi.spyOn(client, 'isMutating').mockReturnValue(1);
    const refetchQueries = vi.spyOn(client, 'refetchQueries').mockResolvedValue([] as any);
    await refetchCurrentScreen(client, '/cart');
    const arg = refetchQueries.mock.calls[0][0] as {
      predicate: (query: { queryKey: unknown[] }) => boolean;
    };
    expect(arg.predicate({ queryKey: ['cart-items', 'u1'] })).toBe(false);
    expect(arg.predicate({ queryKey: ['marketplace-sellers'] })).toBe(true);
  });

  it('keeps a search query path eligible so results can refresh without clearing the term', () => {
    expect(isPullToRefreshDisabledPath('/search')).toBe(false);
  });
});

describe('pull-to-refresh wiring', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('mounts the host inside the router and query client', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/PullToRefreshHost/);
    expect(app).toMatch(/QueryClientProvider/);
    expect(app).toMatch(/HashRouter/);
  });

  it('does not silently drop unavailable cart lines on refresh', () => {
    const cart = read('src/hooks/useCart.tsx');
    expect(cart).toMatch(/Keep unavailable products visible/);
    expect(cart).not.toMatch(/item\.product\.is_available !== false/);
  });

  it('blocks checkout and onboarding pulls', () => {
    const cartPage = read('src/pages/CartPage.tsx');
    expect(cartPage).toMatch(/useBlockPullToRefresh/);
    expect(cartPage).toMatch(/showRazorpayCheckout/);
    const overlay = read('src/components/checkout/OrderProgressOverlay.tsx');
    expect(overlay).toMatch(/data-checkout-in-progress/);
  });
});
