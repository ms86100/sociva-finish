// @ts-nocheck
import { useEffect, useRef, useCallback } from 'react';

/**
 * Shared draft persistence utility for product forms.
 * Uses localStorage for cross-session persistence with 500ms debounce.
 */

const DEBOUNCE_MS = 500;

export function buildDraftKey(prefix: string, sellerId: string): string {
  return `${prefix}_${sellerId}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* quota exceeded — non-critical */ }
}

export function clearDraft(key: string): void {
  localStorage.removeItem(key);
  // Also clean up legacy sessionStorage key if present
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Hook that auto-persists data to localStorage with debounce.
 * Returns a clear function.
 */
export function useAutoSaveDraft<T>(
  key: string,
  data: T,
  enabled: boolean,
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeDraft(key, data);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [key, data, enabled]);

  return useCallback(() => {
    clearTimeout(timerRef.current);
    clearDraft(key);
  }, [key]);
}
