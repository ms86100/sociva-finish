// @ts-nocheck
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'recently_viewed';
const MAX_ITEMS = 10;

export function useRecentlyViewed() {
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string').slice(0, MAX_ITEMS) : [];
    } catch {
      return [];
    }
  });

  const addViewed = useCallback((productId: string) => {
    if (!productId || typeof productId !== 'string') return;
    setRecentIds(prev => {
      const next = [productId, ...prev.filter(id => id !== productId)].slice(0, MAX_ITEMS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* storage full */ }
      return next;
    });
  }, []);

  return { recentIds, addViewed };
}
