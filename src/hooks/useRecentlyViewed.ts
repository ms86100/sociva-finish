// @ts-nocheck
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'recently_viewed';
const MAX_ITEMS = 10;

export function useRecentlyViewed() {
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const addViewed = useCallback((productId: string) => {
    setRecentIds(prev => {
      const next = [productId, ...prev.filter(id => id !== productId)].slice(0, MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentIds, addViewed };
}
