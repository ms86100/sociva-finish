// @ts-nocheck
import { useState, useCallback } from 'react';

/**
 * Hook to track loading state per action item (by ID).
 * Returns [loadingId, wrappedAction] where loadingId is the currently loading item's ID.
 */
export function useActionLoading() {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const withLoading = useCallback(
    (fn: (id: string) => Promise<void>) => async (id: string) => {
      setLoadingId(id);
      try {
        await fn(id);
      } finally {
        setLoadingId(null);
      }
    },
    []
  );

  return { loadingId, withLoading };
}
