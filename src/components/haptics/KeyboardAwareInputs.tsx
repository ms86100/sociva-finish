import { useEffect } from 'react';

function isEditable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select, [contenteditable="true"]');
}

function scrollFocusedIntoView() {
  const el = document.activeElement;
  if (!isEditable(el)) return;
  // Drawers manage their own keyboard lift/scroll. Centering here throws the
  // focused field off the top of the sheet.
  if (el.closest('[data-drawer-scroll]')) return;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

/**
 * Keeps the focused text field visible above the mobile keyboard
 * across pages, sheets, and dialogs.
 */
export function KeyboardAwareInputs() {
  useEffect(() => {
    const setInset = (px = 0) => {
      document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, px)}px`);
    };

    const fromVisualViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return 0;
      return Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    };

    let baselineHeight = window.innerHeight;

    const applyOverlayInset = (nativeHeight = 0) => {
      // If Capacitor already resized the WebView, extra padding would double-shift the page.
      const bodyAlreadyResized = baselineHeight - window.innerHeight > 80;
      if (bodyAlreadyResized) {
        setInset(0);
        return;
      }
      const visual = fromVisualViewport();
      setInset(Math.max(visual, nativeHeight));
    };

    const onViewportChange = () => {
      applyOverlayInset(0);
      if (fromVisualViewport() > 60) {
        requestAnimationFrame(() => setTimeout(scrollFocusedIntoView, 50));
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target as Element)) return;
      setTimeout(scrollFocusedIntoView, 350);
    };

    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);
    document.addEventListener('focusin', onFocusIn);

    let removeNative: (() => void) | undefined;
    (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        const shown = await Keyboard.addListener('keyboardDidShow', (info) => {
          applyOverlayInset(info.keyboardHeight || 0);
          setTimeout(scrollFocusedIntoView, 50);
        });
        const hidden = await Keyboard.addListener('keyboardDidHide', () => {
          baselineHeight = window.innerHeight;
          setInset(0);
        });
        removeNative = () => {
          shown.remove();
          hidden.remove();
        };
      } catch {
        /* web / plugin missing */
      }
    })();

    return () => {
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
      document.removeEventListener('focusin', onFocusIn);
      removeNative?.();
      setInset(0);
    };
  }, []);

  return null;
}
