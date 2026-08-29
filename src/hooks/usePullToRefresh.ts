import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { hapticImpact } from '@/lib/haptics';
import {
  acquirePullToRefreshBlock,
  applyPullResistance,
  classifyPullMove,
  getScrollRoot,
  getVerticalScrollParent,
  isAtScrollTop,
  isBlockingOverlayOpen,
  isEditableElement,
  isKeyboardOpen,
  isPullToRefreshDisabledPath,
  isPullToRefreshHardBlocked,
  PULL_THRESHOLD_PX,
  refetchCurrentScreen,
  registerScreenRefresh,
  shouldBeginPull,
} from '@/lib/pull-to-refresh';

export function useRegisterScreenRefresh(
  fn: () => Promise<void> | void,
  enabled = true,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    return registerScreenRefresh(() => fnRef.current());
  }, [enabled]);
}

export function useBlockPullToRefresh(blocked: boolean): void {
  useEffect(() => {
    if (!blocked) return;
    return acquirePullToRefreshBlock();
  }, [blocked]);
}

export interface PullToRefreshController {
  pullDistance: number;
  refreshing: boolean;
  armed: boolean;
  platform: 'ios' | 'android' | 'web';
}

export function usePullToRefresh(): PullToRefreshController {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [pullDistance, setPullDistanceState] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const trackingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const armedHapticRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  const setPullDistance = (value: number) => {
    pullDistanceRef.current = value;
    setPullDistanceState((prev) => (Math.abs(prev - value) < 1 && !(value === 0 && prev !== 0) ? prev : value));
  };

  const resetPull = useCallback(() => {
    trackingRef.current = false;
    pointerIdRef.current = null;
    armedHapticRef.current = false;
    setPullDistance(0);
  }, []);

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullDistance(PULL_THRESHOLD_PX);

    const outcome = await refetchCurrentScreen(queryClient, location.pathname);

    refreshingRef.current = false;
    setRefreshing(false);
    setPullDistance(0);

    if (outcome.hadError || outcome.timedOut) {
      toast.error("Couldn't refresh right now. Pull down to try again.");
    }
  }, [location.pathname, queryClient]);

  useEffect(() => {
    const root = getScrollRoot();
    if (!root) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (refreshingRef.current || trackingRef.current) return;
      if (isPullToRefreshDisabledPath(location.pathname)) return;
      if (isPullToRefreshHardBlocked()) return;
      if (isBlockingOverlayOpen()) return;

      const scroller = getVerticalScrollParent(event.target, root);
      const atTop = isAtScrollTop(scroller) && isAtScrollTop(root);
      if (
        !shouldBeginPull({
          overlayOpen: false,
          routeDisabled: false,
          blocked: false,
          keyboardOpen: isKeyboardOpen(),
          startedOnEditable: isEditableElement(event.target),
          atScrollTop: atTop,
        })
      ) {
        return;
      }

      trackingRef.current = true;
      pointerIdRef.current = event.pointerId;
      startXRef.current = event.clientX;
      startYRef.current = event.clientY;
      armedHapticRef.current = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!trackingRef.current || event.pointerId !== pointerIdRef.current) return;
      if (refreshingRef.current) return;

      const dx = event.clientX - startXRef.current;
      const dy = event.clientY - startYRef.current;
      const kind = classifyPullMove(dx, dy);

      if (kind === 'cancel-horizontal' || kind === 'cancel-up') {
        resetPull();
        return;
      }
      if (kind === 'ignore') return;

      const scroller = getVerticalScrollParent(event.target, root);
      if (!isAtScrollTop(scroller) || !isAtScrollTop(root)) {
        resetPull();
        return;
      }

      if (isBlockingOverlayOpen() || isPullToRefreshHardBlocked()) {
        resetPull();
        return;
      }

      const resisted = applyPullResistance(dy);
      if (resisted > 8 && event.cancelable) {
        event.preventDefault();
      }
      setPullDistance(resisted);

      if (resisted >= PULL_THRESHOLD_PX && !armedHapticRef.current) {
        armedHapticRef.current = true;
        hapticImpact('light');
      } else if (resisted < PULL_THRESHOLD_PX) {
        armedHapticRef.current = false;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!trackingRef.current || event.pointerId !== pointerIdRef.current) return;
      const shouldRefresh = pullDistanceRef.current >= PULL_THRESHOLD_PX;
      trackingRef.current = false;
      pointerIdRef.current = null;
      armedHapticRef.current = false;

      if (shouldRefresh) {
        void runRefresh();
        return;
      }
      setPullDistance(0);
    };

    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });

    const onTouchMove = (event: TouchEvent) => {
      if (!trackingRef.current) return;
      if (pullDistanceRef.current > 8 && event.cancelable) {
        event.preventDefault();
      }
    };
    root.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      root.removeEventListener('touchmove', onTouchMove);
    };
  }, [location.pathname, resetPull, runRefresh]);

  const rawPlatform = Capacitor.getPlatform();
  const platform: 'ios' | 'android' | 'web' =
    rawPlatform === 'ios' || rawPlatform === 'android' ? rawPlatform : 'web';

  return {
    pullDistance,
    refreshing,
    armed: pullDistance >= PULL_THRESHOLD_PX || refreshing,
    platform,
  };
}
