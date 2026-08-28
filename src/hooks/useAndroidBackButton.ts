// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { isTabRootPath, peekPreviousPath, resolveBackFallback } from '@/lib/navigation-stack';

const ROOT_PATHS = new Set(['/', '/home', '/welcome', '/landing', '/auth']);

/**
 * Android hardware back:
 * 1) Close topmost Radix dialog/sheet (Escape)
 * 2) Else navigate back if history allows
 * 3) Else double-back to minimize (Android only — no-op on iOS)
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastBackAtRef = useRef(0);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;

    let remove: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');

        const listener = await App.addListener('backButton', ({ canGoBack }) => {
          // 1) Dismiss open overlays (dialogs, sheets, alert-dialogs)
          const openOverlay = document.querySelector('[role="dialog"][data-state="open"]');
          if (openOverlay) {
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
            );
            return;
          }

          // 2) In-app history
          const path = location.pathname || '/';
          const atRoot = ROOT_PATHS.has(path) || isTabRootPath(path);
          if (!atRoot) {
            const returnTo = location.state?.returnTo;
            if (typeof returnTo === 'string' && returnTo.startsWith('/')) {
              navigate(returnTo);
              return;
            }
            const previous = peekPreviousPath(path);
            if (previous) {
              navigate(previous);
              return;
            }
            navigate(resolveBackFallback(path));
            return;
          }

          // 3) Root: double-back to minimize
          const now = Date.now();
          if (now - lastBackAtRef.current < 2000) {
            App.minimizeApp();
            return;
          }
          lastBackAtRef.current = now;
          toast.message('Press back again to exit', { id: 'android-back-exit', duration: 2000 });
        });

        remove = () => listener.remove();
      } catch (err) {
        console.error('Failed to register Android backButton listener:', err);
      }
    })();

    return () => remove?.();
  }, [navigate, location.pathname]);
}
