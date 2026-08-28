// @ts-nocheck
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { peekPreviousPath, resolveBackFallback } from '@/lib/navigation-stack';

type SmartBackOptions = {
  /** Explicit destination when stack/history is empty or untrusted */
  fallback?: string;
  /** Skip browser history entirely */
  preferFallback?: boolean;
};

/**
 * Navigate back to a meaningful in-app parent — not arbitrary browser history.
 */
export function useSmartBack(defaultFallback?: string) {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback((options?: SmartBackOptions) => {
    const fallback = options?.fallback || defaultFallback || resolveBackFallback(location.pathname);

    const returnTo = location.state?.returnTo;
    if (typeof returnTo === 'string' && returnTo.startsWith('/')) {
      navigate(returnTo);
      return;
    }

    if (location.state?.from === 'deeplink' || options?.preferFallback) {
      navigate(fallback);
      return;
    }

    const previous = peekPreviousPath(location.pathname);
    if (previous) {
      navigate(previous);
      return;
    }

    navigate(fallback);
  }, [defaultFallback, location.pathname, location.state, navigate]);
}
