import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { hasRazorpayCheckout } from '@/lib/razorpay-checkout-dom';

/** Fired after a successful pull-to-refresh so screens can revalidate non-RQ data. */
export const PULL_TO_REFRESH_EVENT = 'sociva:pull-to-refresh';

export const PULL_THRESHOLD_PX = 72;
export const PULL_MAX_PX = 112;
export const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Near-static config that should not ride along with every pull.
 * Marketplace/order/cart/notification queries stay eligible.
 */
export const STATIC_QUERY_PREFIXES = new Set([
  'category-configs',
  'badge-config',
  'parent-groups',
  'status-display-config',
  'terminal-statuses',
  'available-workflows',
  'action-type-workflow-map',
  'workflow-map',
  'resolved-category-aliases',
  'system-settings-all',
  'payment-gateway-mode',
  'financial-capabilities',
  'pricing-plans',
]);

/**
 * Routes where a pull would destroy in-progress input, duplicate a payment,
 * or reset onboarding/checkout. Match is prefix or regex.
 */
const DISABLED_EXACT = new Set([
  '/auth',
  '/welcome',
  '/landing',
  '/reset-password',
]);

const DISABLED_PREFIXES = [
  '/become-seller',
  '/profile/edit',
  '/seller/products/new',
  '/worker-hire/create',
];

const DISABLED_PATTERNS: RegExp[] = [
  /^\/seller\/products\/[^/]+\/edit$/,
];

export type PullMoveKind = 'pull' | 'cancel-horizontal' | 'cancel-up' | 'ignore';

export interface RefreshOutcome {
  ok: boolean;
  timedOut: boolean;
  hadError: boolean;
  durationMs: number;
}

export interface BeginPullInput {
  overlayOpen: boolean;
  routeDisabled: boolean;
  blocked: boolean;
  keyboardOpen: boolean;
  startedOnEditable: boolean;
  atScrollTop: boolean;
}

type ScreenRefreshFn = () => Promise<void> | void;

const screenRefreshers = new Set<ScreenRefreshFn>();
let blockCount = 0;

export function registerScreenRefresh(fn: ScreenRefreshFn): () => void {
  screenRefreshers.add(fn);
  return () => {
    screenRefreshers.delete(fn);
  };
}

export function acquirePullToRefreshBlock(): () => void {
  blockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    blockCount = Math.max(0, blockCount - 1);
  };
}

export function isPullToRefreshHardBlocked(): boolean {
  return blockCount > 0;
}

export function __resetPullToRefreshRegistryForTests(): void {
  screenRefreshers.clear();
  blockCount = 0;
}

export function isPullToRefreshDisabledPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (DISABLED_EXACT.has(path)) return true;
  if (DISABLED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }
  return DISABLED_PATTERNS.some((re) => re.test(path));
}

export function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function queryKeyHead(queryKey: QueryKey): string | null {
  const head = queryKey[0];
  return typeof head === 'string' ? head : null;
}

export function shouldRefetchQueryKey(
  queryKey: QueryKey,
  opts: { skipCart?: boolean } = {},
): boolean {
  const head = queryKeyHead(queryKey);
  if (!head) return false;
  if (STATIC_QUERY_PREFIXES.has(head)) return false;
  if (opts.skipCart && (head === 'cart-items' || head === 'cart-count')) return false;
  return true;
}

export function applyPullResistance(rawPx: number): number {
  if (rawPx <= 0) return 0;
  return Math.min(PULL_MAX_PX, rawPx * 0.55);
}

export function classifyPullMove(dx: number, dy: number): PullMoveKind {
  if (dy < -8 && Math.abs(dy) > Math.abs(dx)) return 'cancel-up';
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) return 'cancel-horizontal';
  if (dy <= 0) return 'ignore';
  return 'pull';
}

export function shouldBeginPull(input: BeginPullInput): boolean {
  if (input.routeDisabled || input.overlayOpen || input.blocked) return false;
  if (input.keyboardOpen && input.startedOnEditable) return false;
  if (!input.atScrollTop) return false;
  return true;
}

export function isEditableElement(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  const node = el.closest('input, textarea, select, [contenteditable="true"]');
  return !!node;
}

export function isKeyboardOpen(root: HTMLElement = document.documentElement): boolean {
  const inset = Number.parseFloat(root.style.getPropertyValue('--keyboard-inset') || '') ||
    Number.parseFloat(getComputedStyle(root).getPropertyValue('--keyboard-inset') || '') ||
    0;
  if (inset > 40) return true;
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv && window.innerHeight - vv.height > 80) return true;
  return false;
}

export function getScrollRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('root');
}

export function isScrollableY(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  return el.scrollHeight > el.clientHeight + 1;
}

export function getVerticalScrollParent(
  start: EventTarget | null,
  fallback: HTMLElement,
): HTMLElement {
  let node: Element | null = start instanceof Element ? start : null;
  while (node && node !== fallback && node !== document.body && node !== document.documentElement) {
    if (node instanceof HTMLElement && isScrollableY(node)) return node;
    node = node.parentElement;
  }
  return fallback;
}

export function isAtScrollTop(el: HTMLElement | null): boolean {
  if (!el) return true;
  return el.scrollTop <= 1;
}

const OVERLAY_SELECTORS = [
  '[data-ptr-block="true"]',
  '[data-checkout-in-progress="true"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-vaul-drawer][data-state="open"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

export function isBlockingOverlayOpen(root: ParentNode = document): boolean {
  if (hasRazorpayCheckout(root)) return true;
  if (root.querySelector(OVERLAY_SELECTORS)) return true;
  return false;
}

export async function runRegisteredScreenRefreshers(): Promise<boolean> {
  let hadError = false;
  const runners = Array.from(screenRefreshers);
  await Promise.all(
    runners.map(async (fn) => {
      try {
        await fn();
      } catch {
        hadError = true;
      }
    }),
  );
  return hadError;
}

export async function refetchCurrentScreen(
  queryClient: QueryClient,
  pathname: string,
): Promise<RefreshOutcome> {
  const started = Date.now();
  if (isPullToRefreshDisabledPath(pathname) || isPullToRefreshHardBlocked()) {
    return { ok: true, timedOut: false, hadError: false, durationMs: 0 };
  }

  const skipCart = queryClient.isMutating() > 0;
  let timedOut = false;
  let hadError = false;
  let timeoutId = 0;

  const work = (async () => {
    const registeredFailed = await runRegisteredScreenRefreshers();
    if (registeredFailed) hadError = true;

    await queryClient.refetchQueries({
      type: 'active',
      predicate: (query) => shouldRefetchQueryKey(query.queryKey, { skipCart }),
    });

    for (const query of queryClient.getQueryCache().getAll()) {
      if (!query.isActive()) continue;
      if (!shouldRefetchQueryKey(query.queryKey, { skipCart })) continue;
      if (query.state.status === 'error' && query.state.errorUpdatedAt >= started) {
        hadError = true;
      }
    }
  })();

  const timeout = new Promise<void>((resolve) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      resolve();
    }, REFRESH_TIMEOUT_MS);
  });

  try {
    await Promise.race([work, timeout]);
  } catch {
    hadError = true;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PULL_TO_REFRESH_EVENT, { detail: { pathname: normalizePath(pathname) } }),
    );
  }

  return {
    ok: !hadError && !timedOut,
    timedOut,
    hadError: hadError || timedOut,
    durationMs: Date.now() - started,
  };
}
