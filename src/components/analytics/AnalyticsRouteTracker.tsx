// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { track } from '@/lib/analytics';

/** Emit page_viewed on HashRouter location changes. */
export function AnalyticsRouteTracker() {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    if (lastPath.current === path) return;
    lastPath.current = path;
    track('page_viewed', { path });
  }, [location.pathname, location.search]);

  return null;
}
