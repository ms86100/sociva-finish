// @ts-nocheck
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  commitReplaceBack,
  planBackNavigation,
  resolveBackFallback,
  toNavPath,
} from '@/lib/navigation-stack';

type SmartBackOptions = {
  /** Explicit destination when the journey has no previous in-app screen */
  fallback?: string;
  /** Skip the journey and use the fallback (external entry). */
  preferFallback?: boolean;
};

/**
 * Return to the previous meaningful in-app screen.
 * Uses browser history only when this screen was pushed inside the current journey.
 * Deep links, push taps, and refreshes fall back to the logical parent.
 * `location.state.returnTo` is an after-auth continuation target, not a back target.
 */
export function runSmartBack(navigate, location, options?: SmartBackOptions) {
  const pathname = location?.pathname || '/';
  const search = location?.search || '';
  const state = location?.state;
  const external = state?.from === 'deeplink' || state?.from === 'push';
  const fallback = options?.fallback || resolveBackFallback(pathname);
  const decision = planBackNavigation(toNavPath(pathname, search), {
    fallback,
    preferFallback: options?.preferFallback || external,
  });

  if (decision.type === 'history') {
    navigate(-1);
    return;
  }

  commitReplaceBack(decision.to);
  navigate(decision.to, { replace: true, state: { socivaBack: true } });
}

export function useSmartBack(defaultFallback?: string) {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback((options?: SmartBackOptions) => {
    runSmartBack(navigate, location, {
      fallback: options?.fallback || defaultFallback,
      preferFallback: options?.preferFallback,
    });
  }, [defaultFallback, location, navigate]);
}
