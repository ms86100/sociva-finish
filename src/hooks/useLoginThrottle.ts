// @ts-nocheck
// Bug 9: This is a UX-only client-side throttle. Real protection is server-side via rate_limits table.
// localStorage can be cleared by the user — this only provides friendly feedback, not security.
import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'login_attempts';
const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_SECONDS = 30;

interface AttemptState {
  count: number;
  lockedUntil: number | null; // unix ms
}

function getStoredState(): AttemptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { count: parsed.count || 0, lockedUntil: parsed.lockedUntil || null };
    }
  } catch { /* ignore */ }
  return { count: 0, lockedUntil: null };
}

function persistState(state: AttemptState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Client-side login attempt throttle with exponential backoff.
 * After MAX_ATTEMPTS failures, locks out for BASE_LOCKOUT * 2^(excess) seconds.
 */
export function useLoginThrottle() {
  const [attemptState, setAttemptState] = useState<AttemptState>(getStoredState);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateCountdown = useCallback(() => {
    const state = getStoredState();
    if (state.lockedUntil && state.lockedUntil > Date.now()) {
      setRemainingSeconds(Math.ceil((state.lockedUntil - Date.now()) / 1000));
    } else {
      setRemainingSeconds(0);
      if (state.lockedUntil) {
        // Lockout expired, reset count
        const newState = { count: 0, lockedUntil: null };
        persistState(newState);
        setAttemptState(newState);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    updateCountdown();
    if (attemptState.lockedUntil && attemptState.lockedUntil > Date.now()) {
      timerRef.current = setInterval(updateCountdown, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [attemptState.lockedUntil, updateCountdown]);

  const isLocked = remainingSeconds > 0;

  const recordFailure = useCallback(() => {
    const current = getStoredState();
    const newCount = current.count + 1;
    let lockedUntil: number | null = null;

    if (newCount >= MAX_ATTEMPTS) {
      const excess = newCount - MAX_ATTEMPTS;
      const lockoutMs = BASE_LOCKOUT_SECONDS * Math.pow(2, excess) * 1000;
      lockedUntil = Date.now() + lockoutMs;
    }

    const newState = { count: newCount, lockedUntil };
    persistState(newState);
    setAttemptState(newState);
  }, []);

  const recordSuccess = useCallback(() => {
    const newState = { count: 0, lockedUntil: null };
    persistState(newState);
    setAttemptState(newState);
  }, []);

  return {
    isLocked,
    remainingSeconds,
    attemptCount: attemptState.count,
    maxAttempts: MAX_ATTEMPTS,
    recordFailure,
    recordSuccess,
  };
}
