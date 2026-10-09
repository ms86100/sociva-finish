// @ts-nocheck
import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { readScrollPosition, saveScrollPosition, toNavPath } from '@/lib/navigation-stack';

/**
 * Restores window scroll when the user comes back to a route.
 * Query-only replaces (search typing) keep the current scroll.
 */
export function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const full = toNavPath(location.pathname, location.search);
  const isBack = navType === 'POP' || location.state?.socivaBack === true;

  useLayoutEffect(() => {
    if (isBack) {
      const y = readScrollPosition(full);
      const restore = () => window.scrollTo(0, y);
      restore();
      const frame = requestAnimationFrame(restore);
      return () => {
        cancelAnimationFrame(frame);
        saveScrollPosition(full, window.scrollY);
      };
    }
    if (navType === 'PUSH') {
      window.scrollTo(0, 0);
    }
    return () => {
      saveScrollPosition(full, window.scrollY);
    };
  }, [full, isBack, navType]);

  return null;
}
