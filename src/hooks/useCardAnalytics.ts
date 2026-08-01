// @ts-nocheck
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * DB-backed analytics tracking for ProductListingCard.
 * Writes to marketplace_events table.
 * 
 * Fix #3: Uses a SHARED IntersectionObserver singleton instead of
 * creating one per card. With 30+ cards, this avoids 30 observers.
 */

interface CardEvent {
  productId: string;
  category: string;
  price: number;
  sellerId: string;
  layout: string;
}

// ── Batched impression queue ──
let impressionQueue: CardEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let cachedUserId: string | null | undefined = undefined;

async function getUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  try {
    const { data } = await supabase.auth.getSession();
    cachedUserId = data?.session?.user?.id || null;
    setTimeout(() => { cachedUserId = undefined; }, 5 * 60 * 1000);
  } catch {
    cachedUserId = null;
  }
  return cachedUserId;
}

async function flushImpressions() {
  if (impressionQueue.length === 0) return;
  const batch = impressionQueue.splice(0);
  const userId = await getUserId();

  try {
    await supabase.from('marketplace_events').insert(
      batch.map(data => ({
        product_id: data.productId,
        seller_id: data.sellerId,
        category: data.category,
        layout_type: data.layout,
        event_type: 'impression',
        user_id: userId,
        metadata: { price: data.price },
      }))
    );
  } catch {
    // Silent fail — analytics must never break UI
  }
}

function queueImpression(data: CardEvent) {
  impressionQueue.push(data);
  if (flushTimer) clearTimeout(flushTimer);
  if (impressionQueue.length >= 20) {
    flushImpressions();
  } else {
    flushTimer = setTimeout(flushImpressions, 2000);
  }
}

async function emitSingle(eventType: string, data: CardEvent) {
  try {
    const userId = await getUserId();
    await supabase.from('marketplace_events').insert({
      product_id: data.productId,
      seller_id: data.sellerId,
      category: data.category,
      layout_type: data.layout,
      event_type: eventType,
      user_id: userId,
      metadata: { price: data.price },
    });
  } catch {
    // Silent fail
  }
}

// ── Fix #3: Shared IntersectionObserver singleton ──
type ObserverEntry = { element: Element; callback: () => void };
let sharedObserver: IntersectionObserver | null = null;
const observedElements = new Map<Element, () => void>();

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cb = observedElements.get(entry.target);
            if (cb) {
              cb();
              // Unobserve after first impression
              sharedObserver?.unobserve(entry.target);
              observedElements.delete(entry.target);
            }
          }
        }
      },
      { threshold: 0.5 }
    );
  }
  return sharedObserver;
}

function observeElement(element: Element, callback: () => void) {
  observedElements.set(element, callback);
  getSharedObserver().observe(element);
}

function unobserveElement(element: Element) {
  observedElements.delete(element);
  sharedObserver?.unobserve(element);
}

export function useCardAnalytics(product: CardEvent) {
  const impressionFired = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const payload: CardEvent = {
    productId: product.productId,
    category: product.category,
    price: product.price,
    sellerId: product.sellerId,
    layout: product.layout,
  };

  // Fix #3: Register with shared observer instead of creating individual one
  useEffect(() => {
    const el = ref.current;
    if (!el || impressionFired.current) return;

    observeElement(el, () => {
      if (!impressionFired.current) {
        impressionFired.current = true;
        queueImpression(payload);
      }
    });

    return () => { unobserveElement(el); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.productId]);

  const onCardClick = useCallback(() => {
    emitSingle('click', payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.productId]);

  const onAddClick = useCallback(() => {
    emitSingle('add_to_cart', payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.productId]);

  const onWishlistClick = useCallback(() => {
    emitSingle('wishlist', payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.productId]);

  return { ref, onCardClick, onAddClick, onWishlistClick };
}
