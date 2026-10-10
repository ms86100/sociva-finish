// @ts-nocheck
import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { readScrollPosition, saveScrollPosition, toNavPath } from '@/lib/navigation-stack';
import { getScrollRoot } from '@/lib/pull-to-refresh';

/**
 * Restores scroll when the user comes back to a route.
 * html/body are overflow:hidden, so the page scrolls inside #root, not window.
 * Query-only replaces (search typing) keep the current scroll.
 */
function readScrollY(): number {
  return getScrollRoot()?.scrollTop ?? 0;
}

function scrollToY(y: number) {
  const root = getScrollRoot();
  if (root) root.scrollTop = y;
}

export function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const full = toNavPath(location.pathname, location.search);
  const isBack = navType === 'POP' || location.state?.socivaBack === true;

  useLayoutEffect(() => {
    if (isBack) {
      const y = readScrollPosition(full);
      const restore = () => scrollToY(y);
      restore();
      const frame = requestAnimationFrame(restore);
      return () => {
        cancelAnimationFrame(frame);
        saveScrollPosition(full, readScrollY());
      };
    }
    if (navType === 'PUSH') {
      scrollToY(0);
    }
    return () => {
      saveScrollPosition(full, readScrollY());
    };
  }, [full, isBack, navType]);

  return null;
}
