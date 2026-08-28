/**
 * In-app navigation stack for meaningful back navigation.
 * Browser history alone is unreliable (auth redirects, deeplinks, tab switches).
 */

export const TAB_ROOT_PATHS = new Set(['/', '/orders', '/cart', '/society', '/profile']);

const stack: string[] = [];

/** @internal test helper */
export function resetNavigationStackForTests(): void {
  stack.length = 0;
}

export function isTabRootPath(pathname: string): boolean {
  return TAB_ROOT_PATHS.has(pathname);
}

export function shouldShowHeaderBack(pathname: string, showBack?: boolean): boolean {
  if (showBack === false) return false;
  if (showBack === true) return true;
  return !isTabRootPath(pathname);
}

export function recordNavigationPath(pathname: string, navType: 'PUSH' | 'POP' | 'REPLACE'): void {
  const path = pathname || '/';

  if (navType === 'POP') {
    while (stack.length > 0 && stack[stack.length - 1] !== path) {
      stack.pop();
    }
    return;
  }

  if (navType === 'REPLACE') {
    if (stack.length === 0) {
      stack.push(path);
      return;
    }
    stack[stack.length - 1] = path;
    return;
  }

  if (isTabRootPath(path)) {
    if (stack.length === 0 || !isTabRootPath(stack[stack.length - 1])) {
      stack.push(path);
    } else {
      stack[stack.length - 1] = path;
    }
    return;
  }

  const last = stack[stack.length - 1];
  if (last === path) return;
  stack.push(path);
  if (stack.length > 40) stack.shift();
}

export function peekPreviousPath(currentPath: string): string | null {
  const current = currentPath || '/';
  for (let i = stack.length - 2; i >= 0; i -= 1) {
    const candidate = stack[i];
    if (candidate && candidate !== current) return candidate;
  }
  return null;
}

/** Context-aware fallback when stack / history cannot be trusted. */
export function resolveBackFallback(pathname: string): string {
  const path = pathname || '/';

  if (path.startsWith('/seller/')) return '/seller';
  if (path === '/seller') return '/profile';
  if (path.startsWith('/order/')) return '/orders';
  if (path.startsWith('/profile/')) return '/profile';
  if (path === '/cart') return '/';
  if (path.startsWith('/search')) return '/';
  if (path.startsWith('/category')) return '/';
  if (path.startsWith('/discovery')) return '/';
  if (path.startsWith('/favorites')) return '/profile';
  if (path.startsWith('/festival')) return '/';
  if (path.startsWith('/notifications')) return '/';
  if (path.startsWith('/admin')) return '/profile';
  if (path.startsWith('/become-seller')) return '/profile';
  if (path.startsWith('/messages')) return '/orders';
  if (path.match(/^\/s\/[^/]+/) || path.startsWith('/store/')) return '/';
  if (path.startsWith('/society')) return '/society';
  if (isTabRootPath(path)) return '/';
  return '/';
}
