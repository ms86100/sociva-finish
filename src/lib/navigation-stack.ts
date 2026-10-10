/**
 * In-app navigation stack for meaningful back navigation.
 * Browser history alone is unreliable (auth redirects, deeplinks, tab switches).
 *
 * Back policy:
 * 1. Close the top temporary overlay (sheet, dialog, chat, wizard step).
 * 2. If the current entry was pushed inside this journey, pop browser history.
 * 3. Otherwise replace with the logical parent, then the area root.
 * Deep links and push taps start a new journey so Back cannot fall into
 * whatever screen happened to be open before the link.
 */

export const TAB_ROOT_PATHS = new Set(['/', '/profile', '/book', '/services', '/orders']);

const EXIT_ROOTS = new Set(['/', '/welcome', '/landing']);

type StackEntry = {
  path: string;
  /** False for cold start, deep link, and push entry. history.back() is unsafe. */
  trustHistory: boolean;
};

const stack: StackEntry[] = [];

/** Next record() belongs to beginExternalEntry and must not keep the old journey. */
let absorbNextRecord = false;

type InterceptorKind = 'overlay' | 'page';
type Interceptor = { kind: InterceptorKind; run: () => boolean; systemOnly: boolean };
export type BackInterceptorOptions = {
  /** Only hardware/system Back. The on-screen arrow skips it (e.g. keyboard dismiss). */
  systemOnly?: boolean;
};
const interceptors: Interceptor[] = [];

const scrollPositions = new Map<string, number>();

type SmartBackListener = (options?: { fallback?: string }) => void;
const smartBackListeners = new Set<SmartBackListener>();

/** @internal test helper */
export function resetNavigationStackForTests(): void {
  stack.length = 0;
  absorbNextRecord = false;
  interceptors.length = 0;
  scrollPositions.clear();
}

/** @internal test helper */
export function getNavigationStackForTests(): string[] {
  return stack.map((entry) => entry.path);
}

export function toNavPath(pathname: string, search = ''): string {
  const raw = pathname || '/';
  const qIndex = raw.indexOf('?');
  const base = (qIndex >= 0 ? raw.slice(0, qIndex) : raw) || '/';
  const embedded = qIndex >= 0 ? raw.slice(qIndex) : '';
  const extra = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  const query = extra || embedded;
  if (!query || query === '?') return base;
  return `${base}${query}`;
}

export function pathOnly(fullPath: string): string {
  const value = fullPath || '/';
  const q = value.indexOf('?');
  return q >= 0 ? value.slice(0, q) || '/' : value;
}

export function isTabRootPath(pathname: string): boolean {
  return TAB_ROOT_PATHS.has(pathOnly(pathname));
}

export function isExitRoot(pathname: string): boolean {
  return EXIT_ROOTS.has(pathOnly(pathname));
}

export function shouldShowHeaderBack(pathname: string, showBack?: boolean): boolean {
  if (showBack === false) return false;
  if (showBack === true) return true;
  return !isTabRootPath(pathname);
}

function collapseDuplicateTop(): void {
  if (stack.length >= 2 && stack[stack.length - 1].path === stack[stack.length - 2].path) {
    stack.pop();
  }
}

export function recordNavigationPath(pathname: string, navType: 'PUSH' | 'POP' | 'REPLACE', search = ''): void {
  const path = toNavPath(pathname, search);

  if (absorbNextRecord) {
    absorbNextRecord = false;
    stack.length = 0;
    stack.push({ path, trustHistory: false });
    return;
  }

  if (navType === 'POP') {
    if (stack.length === 0) {
      stack.push({ path, trustHistory: false });
      return;
    }
    const idx = stack.map((entry) => entry.path).lastIndexOf(path);
    if (idx >= 0) {
      stack.length = idx + 1;
      return;
    }
    stack.push({ path, trustHistory: false });
    return;
  }

  if (navType === 'REPLACE') {
    if (stack.length === 0) {
      stack.push({ path, trustHistory: false });
      return;
    }
    const trust = stack[stack.length - 1].trustHistory;
    stack[stack.length - 1] = { path, trustHistory: trust };
    collapseDuplicateTop();
    return;
  }

  if (isTabRootPath(path)) {
    const last = stack[stack.length - 1];
    if (!last || !isTabRootPath(last.path)) {
      stack.push({ path, trustHistory: true });
    } else if (last.path !== path) {
      last.path = path;
    }
    if (stack.length > 40) stack.shift();
    return;
  }

  const last = stack[stack.length - 1];
  if (last?.path === path) return;
  stack.push({ path, trustHistory: true });
  if (stack.length > 40) stack.shift();
}

/**
 * Push / shared link / notification tap. The next recorded route becomes the
 * only entry, and browser Back must not return to the pre-link screen.
 */
export function beginExternalEntry(fullPath: string): void {
  const path = toNavPath(fullPath);
  stack.length = 0;
  stack.push({ path, trustHistory: false });
  absorbNextRecord = true;
}

/**
 * Browser popped off an external root into whatever was underneath.
 * Returns the safe fallback the UI should replace with, or null.
 */
export function consumeUntrustedPop(nextPath: string): string | null {
  const next = toNavPath(nextPath);
  if (stack.length === 1 && stack[0].trustHistory === false && stack[0].path !== next) {
    const left = stack[0].path;
    stack.length = 0;
    return resolveBackFallback(pathOnly(left));
  }
  return null;
}

export function peekPreviousPath(currentPath: string): string | null {
  const current = toNavPath(currentPath);
  let start = stack.length - 1;
  if (stack[start]?.path === current) start -= 1;
  for (let i = start; i >= 0; i -= 1) {
    const candidate = stack[i]?.path;
    if (candidate && candidate !== current) return candidate;
  }
  return null;
}

export type BackDecision =
  | { type: 'history' }
  | { type: 'replace'; to: string };

export function planBackNavigation(
  currentFullPath: string,
  options?: { fallback?: string; preferFallback?: boolean },
): BackDecision {
  const current = toNavPath(currentFullPath);
  const fallback = options?.fallback || resolveBackFallback(pathOnly(current));
  if (options?.preferFallback) return { type: 'replace', to: fallback };

  const previous = peekPreviousPath(current);
  const top = stack[stack.length - 1];
  if (previous && top?.trustHistory) return { type: 'history' };
  if (previous) return { type: 'replace', to: previous };
  return { type: 'replace', to: fallback };
}

/** Keep the stack aligned when Back replaces instead of popping history. */
export function commitReplaceBack(target: string): void {
  const path = toNavPath(target);
  const idx = stack.map((entry) => entry.path).lastIndexOf(path);
  if (idx >= 0) {
    stack.length = idx + 1;
    return;
  }
  if (stack.length === 0) {
    stack.push({ path, trustHistory: false });
    return;
  }
  stack[stack.length - 1] = { path, trustHistory: false };
  collapseDuplicateTop();
}

/** Context-aware fallback when the journey stack cannot be trusted. */
export function resolveBackFallback(pathname: string): string {
  const path = pathOnly(pathname || '/');

  if (path.startsWith('/admin/stores/')) {
    const parts = path.split('/').filter(Boolean);
    const sellerId = parts[2];
    if (sellerId && parts[3] === 'products' && (parts[4] === 'new' || parts[5] === 'edit')) {
      return `/admin/stores/${sellerId}/products`;
    }
    if (sellerId && (parts[3] === 'products' || parts[3] === 'settings')) {
      return `/admin/stores/${sellerId}`;
    }
    if (sellerId) return '/admin/stores';
  }
  if (path === '/admin/stores' || path === '/admin/command-center') return '/admin';
  if (path.startsWith('/admin')) return '/admin';

  if (path === '/seller/products/new' || /^\/seller\/products\/[^/]+\/edit$/.test(path)) {
    return '/seller/products';
  }
  if (path === '/seller/payouts') return '/seller/wallet';
  if (
    path === '/seller/products'
    || path === '/seller/settings'
    || path === '/seller/earnings'
    || path === '/seller/wallet'
    || path === '/seller/credits'
    || path === '/seller/messages'
    || path === '/seller/category-requests'
  ) {
    return '/seller';
  }
  if (path === '/seller') return '/profile';
  if (/^\/seller\/[^/]+$/.test(path)) return '/';

  if (/^\/orders\/[^/]+$/.test(path) || /^\/order\/[^/]+$/.test(path)) return '/orders';
  if (path.startsWith('/checkouts/')) return '/orders';
  if (path.startsWith('/profile/')) return '/profile';
  if (path === '/cart' || path.startsWith('/search') || path.startsWith('/categories') || path.startsWith('/category')) {
    return '/';
  }
  if (path.startsWith('/discovery') || path.startsWith('/product/') || path.startsWith('/festival')) return '/';
  if (path.startsWith('/favorites') || path === '/notifications') return '/profile';
  if (path.startsWith('/notifications/inbox')) return '/';
  if (path.startsWith('/become-seller')) return '/profile';
  if (path.startsWith('/messages')) return '/orders';
  if (path === '/community-rules') return '/help';
  if (path === '/help' || path === '/discover-location') return '/';
  if (isTabRootPath(path)) return '/';
  return '/';
}

export function registerBackInterceptor(
  kind: InterceptorKind,
  run: () => boolean,
  options?: BackInterceptorOptions,
): () => void {
  const entry: Interceptor = { kind, run, systemOnly: options?.systemOnly === true };
  interceptors.push(entry);
  return () => {
    const index = interceptors.lastIndexOf(entry);
    if (index >= 0) interceptors.splice(index, 1);
  };
}

export function runBackInterceptors(kind: InterceptorKind, source: 'system' | 'in-app' = 'system'): boolean {
  for (let i = interceptors.length - 1; i >= 0; i -= 1) {
    if (interceptors[i].kind !== kind) continue;
    if (source === 'in-app' && interceptors[i].systemOnly) continue;
    if (interceptors[i].run()) return true;
  }
  return false;
}

const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

/** Close the top Radix/Vaul dialog, alert dialog, drawer, or select list. Returns true when one was open. */
export function tryCloseTopOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  const open = document.querySelectorAll(OPEN_OVERLAY_SELECTOR);
  if (open.length === 0) return false;
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
  );
  return true;
}

/**
 * Overlay (chat, map step, booking review) then dialog, then in-page wizard.
 * Route changes happen only after these return false.
 */
export function handleSystemBackLayers(): boolean {
  if (runBackInterceptors('overlay')) return true;
  if (tryCloseTopOverlay()) return true;
  if (runBackInterceptors('page')) return true;
  return false;
}

/** Same layers for the on-screen back arrow, minus system-only interceptors. */
export function handleInAppBackLayers(): boolean {
  if (runBackInterceptors('overlay', 'in-app')) return true;
  if (tryCloseTopOverlay()) return true;
  if (runBackInterceptors('page', 'in-app')) return true;
  return false;
}

export function subscribeSmartBack(listener: SmartBackListener): () => void {
  smartBackListeners.add(listener);
  return () => smartBackListeners.delete(listener);
}

export function requestSmartBack(options?: { fallback?: string }): void {
  if (smartBackListeners.size === 0) {
    if (typeof window !== 'undefined') window.location.hash = '#/';
    return;
  }
  smartBackListeners.forEach((listener) => listener(options));
}

export function saveScrollPosition(fullPath: string, y: number): void {
  scrollPositions.set(toNavPath(fullPath), Math.max(0, y || 0));
}

export function readScrollPosition(fullPath: string): number {
  return scrollPositions.get(toNavPath(fullPath)) || 0;
}
