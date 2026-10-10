import { useEffect, useState } from 'react';

export const SLOW_LOADING_MS = 8_000;

/** True once `active` has stayed true for `delayMs`; resets when it turns false. */
export function useSlowLoading(active: boolean, delayMs: number = SLOW_LOADING_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return active && slow;
}
