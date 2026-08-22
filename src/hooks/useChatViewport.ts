// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

type ViewportSnapshot = {
  height: number;
  top: number;
  visualKeyboardHeight: number;
};

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

/** Fixed bottom drawers need the full keyboard height, not the residual inset. */
export function useDrawerKeyboard(enabled: boolean) {
  const viewport = useKeyboardViewport(enabled);
  return {
    ...viewport,
    keyboardInset: Math.max(
      viewport.nativeKeyboardHeight,
      viewport.visualKeyboardHeight,
      viewport.keyboardInset,
    ),
  };
}

export function scrollFocusedFieldInDrawer() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select, [contenteditable="true"]')) return;
  const scroller = el.closest('[data-drawer-scroll]');
  if (scroller instanceof HTMLElement) {
    const fieldBox = el.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const nextTop = scroller.scrollTop + (fieldBox.top - scrollerBox.top) - 48;
    scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
