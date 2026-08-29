// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

type ViewportSnapshot = {
  height: number;
  top: number;
  visualKeyboardHeight: number;
};

const BODY_RESIZE_THRESHOLD_PX = 80;

const getViewportSnapshot = (): ViewportSnapshot => {
  if (typeof window === 'undefined') {
    return { height: 0, top: 0, visualKeyboardHeight: 0 };
  }

  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  const top = vv?.offsetTop ?? 0;
  const visualKeyboardHeight = Math.max(0, window.innerHeight - (height + top));

  return { height, top, visualKeyboardHeight };
};

export function useKeyboardViewport(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<ViewportSnapshot>(() => getViewportSnapshot());
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);

  const updateViewport = useCallback(() => {
    setSnapshot(getViewportSnapshot());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    updateViewport();

    const vv = window.visualViewport;
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    vv?.addEventListener('resize', updateViewport);
    vv?.addEventListener('scroll', updateViewport);

    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      vv?.removeEventListener('resize', updateViewport);
      vv?.removeEventListener('scroll', updateViewport);
    };
  }, [enabled, updateViewport]);

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return;

    let isDisposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const setShown = (keyboardHeight: number) => {
      if (!isDisposed) {
        setNativeKeyboardHeight(Math.max(0, keyboardHeight || 0));
      }
    };

    const attach = async () => {
      try {
        handles.push(await Keyboard.addListener('keyboardWillShow', (info) => setShown(info.keyboardHeight)));
        handles.push(await Keyboard.addListener('keyboardDidShow', (info) => setShown(info.keyboardHeight)));
        handles.push(await Keyboard.addListener('keyboardWillHide', () => setShown(0)));
        handles.push(await Keyboard.addListener('keyboardDidHide', () => setShown(0)));
      } catch {
        // Ignore: web/PWA can rely on visualViewport only.
      }
    };

    void attach();

    return () => {
      isDisposed = true;
      setNativeKeyboardHeight(0);
      handles.forEach((handle) => {
        void handle.remove();
      });
    };
  }, [enabled]);

  const keyboardInset = useMemo(() => {
    return Math.max(0, nativeKeyboardHeight - snapshot.visualKeyboardHeight);
  }, [nativeKeyboardHeight, snapshot.visualKeyboardHeight]);

  return {
    viewportHeight: snapshot.height,
    viewportTop: snapshot.top,
    keyboardInset,
    visualKeyboardHeight: snapshot.visualKeyboardHeight,
    nativeKeyboardHeight,
    isKeyboardOpen: snapshot.visualKeyboardHeight > 0 || nativeKeyboardHeight > 0,
  };
}

export function useChatViewport(enabled: boolean) {
  return useKeyboardViewport(enabled);
}

/**
 * How far a `position:fixed` bottom sheet should lift for the keyboard.
 * If Capacitor already resized the WebView (`resize: 'body'`), lifting again
 * throws the focused field off the top of the screen.
 */
export function drawerKeyboardLiftPx({
  baselineInnerHeight,
  innerHeight,
  visualKeyboardHeight,
  nativeKeyboardHeight,
}: {
  baselineInnerHeight: number;
  innerHeight: number;
  visualKeyboardHeight: number;
  nativeKeyboardHeight: number;
}): number {
  const layoutShrink = Math.max(0, baselineInnerHeight - innerHeight);
  if (layoutShrink >= BODY_RESIZE_THRESHOLD_PX) return 0;
  if (visualKeyboardHeight > 0) return visualKeyboardHeight;
  return Math.max(0, nativeKeyboardHeight);
}

export function getDrawerKeyboardStyle({
  viewportHeight,
  keyboardInset,
  isKeyboardOpen,
}: {
  viewportHeight: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
}): { bottom: number; maxHeight: string; paddingBottom?: number } {
  const cap = Math.max((viewportHeight || 0) - 8, 240);
  return {
    bottom: keyboardInset || 0,
    maxHeight: `${cap}px`,
    ...(isKeyboardOpen ? { paddingBottom: 0 } : {}),
  };
}

/** Fixed bottom drawers: lift only by keyboard that still overlaps the layout. */
export function useDrawerKeyboard(enabled: boolean) {
  const viewport = useKeyboardViewport(enabled);
  const baselineRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      baselineRef.current = 0;
      return;
    }
    if (!viewport.isKeyboardOpen) {
      baselineRef.current = window.innerHeight;
    }
  }, [enabled, viewport.isKeyboardOpen]);

  const innerHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const keyboardInset = drawerKeyboardLiftPx({
    baselineInnerHeight: baselineRef.current || innerHeight,
    innerHeight,
    visualKeyboardHeight: viewport.visualKeyboardHeight,
    nativeKeyboardHeight: viewport.nativeKeyboardHeight,
  });

  return {
    ...viewport,
    keyboardInset,
  };
}

export function scrollFocusedFieldInDrawer() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select, [contenteditable="true"]')) return;

  const root = document.getElementById('root');
  if (root && root.scrollTop) root.scrollTop = 0;
  if (typeof window !== 'undefined' && window.scrollY) window.scrollTo(0, 0);

  const wrapped = el.closest('[data-keyboard-field]');
  const anchor = wrapped instanceof HTMLElement ? wrapped : el;
  const scroller = el.closest('[data-drawer-scroll]');
  if (scroller instanceof HTMLElement) {
    const fieldBox = anchor.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const pad = 12;
    const overflowBottom = fieldBox.bottom - (scrollerBox.bottom - pad);
    const overflowTop = scrollerBox.top + pad - fieldBox.top;
    if (overflowBottom > 0) {
      scroller.scrollTo({ top: scroller.scrollTop + overflowBottom, behavior: 'auto' });
    } else if (overflowTop > 0) {
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop - overflowTop), behavior: 'auto' });
    }
    return;
  }
  anchor.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

/** Keep the focused drawer field in view as the keyboard opens or resizes. */
export function useKeepDrawerFieldVisible(open: boolean) {
  const viewport = useDrawerKeyboard(open);

  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return;
    void Keyboard.setScroll({ isDisabled: true }).catch(() => {});
    return () => {
      void Keyboard.setScroll({ isDisabled: false }).catch(() => {});
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let t1 = 0;
    let t2 = 0;
    let raf = 0;
    const run = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scrollFocusedFieldInDrawer();
      });
    };
    const onFocus = () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      t1 = window.setTimeout(run, 50);
      t2 = window.setTimeout(run, 320);
    };

    document.addEventListener('focusin', onFocus);
    window.visualViewport?.addEventListener('resize', run);
    window.visualViewport?.addEventListener('scroll', run);
    run();

    return () => {
      document.removeEventListener('focusin', onFocus);
      window.visualViewport?.removeEventListener('resize', run);
      window.visualViewport?.removeEventListener('scroll', run);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, viewport.keyboardInset, viewport.viewportHeight, viewport.isKeyboardOpen]);

  return viewport;
}
