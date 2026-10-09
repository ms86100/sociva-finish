// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import {
  handleSystemBackLayers,
  isExitRoot,
  peekPreviousPath,
  toNavPath,
} from '@/lib/navigation-stack';
import { runSmartBack } from '@/hooks/useSmartBack';

/**
 * Android hardware back:
 * 1. Close the top overlay / wizard step
 * 2. Return along the in-app journey
 * 3. On Home only, a second press minimizes the app
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastBackAtRef = useRef(0);
  const navigateRef = useRef(navigate);
  const locationRef = useRef(location);
  navigateRef.current = navigate;
  locationRef.current = location;

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return undefined;

    let remove: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('backButton', () => {
          if (handleSystemBackLayers()) return;

          const loc = locationRef.current;
          const full = toNavPath(loc.pathname, loc.search);
          const atExit = isExitRoot(loc.pathname) && !peekPreviousPath(full);
          if (atExit) {
            const now = Date.now();
            if (now - lastBackAtRef.current < 2000) {
              App.minimizeApp();
              return;
            }
            lastBackAtRef.current = now;
            toast.message('Press back again to exit', { id: 'android-back-exit', duration: 2000 });
            return;
          }

          runSmartBack(navigateRef.current, loc);
        });

        if (cancelled) {
          listener.remove();
          return;
        }
        remove = () => listener.remove();
      } catch (err) {
        console.error('Failed to register Android backButton listener:', err);
      }
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
}
