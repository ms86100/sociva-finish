// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { track } from '@/lib/analytics';

function routeFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  if (!hash.startsWith('#/')) return null;
  return hash.slice(1) || '/';
}

/** Emit page_viewed on HashRouter changes, including iOS webview hash updates. */
export function AnalyticsRouteTracker() {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const emit = () => {
      const path = routeFromHash() || `${location.pathname}${location.search || ''}`;
      if (!path || lastPath.current === path) return;
      lastPath.current = path;
      track('page_viewed', { path });
    };

    emit();
    window.addEventListener('hashchange', emit);
    return () => window.removeEventListener('hashchange', emit);
  }, [location.pathname, location.search, location.hash]);

  return null;
}
