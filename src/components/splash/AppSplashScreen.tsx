import { useState, useEffect, useCallback, useRef } from 'react';
import { hideSplashScreen } from '@/lib/capacitor';

// Keep short — HTML #boot-splash already covers JS download; this only bridges auth restore.
const MIN_DISPLAY_MS = 280;
const MAX_DISPLAY_MS = 1600;
const EXIT_MS = 180;

interface AppSplashScreenProps {
  ready: boolean;
  onComplete: () => void;
}

/**
 * Lightweight CSS splash (no framer-motion). Renders over the app while session
 * restores; children hydrate underneath via SplashGate.
 */
export function AppSplashScreen({ ready, onComplete }: AppSplashScreenProps) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const mountTime = useRef(Date.now());
  const completedRef = useRef(false);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    console.log(`[Splash] Total display time: ${Date.now() - mountTime.current}ms`);
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    hideSplashScreen();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), MAX_DISPLAY_MS);
    const forceTimer = setTimeout(finish, MAX_DISPLAY_MS + EXIT_MS + 50);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(forceTimer);
    };
  }, [finish]);

  useEffect(() => {
    if (ready && minElapsed && !exiting) {
      setExiting(true);
    }
  }, [ready, minElapsed, exiting]);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(finish, EXIT_MS);
    return () => clearTimeout(t);
  }, [exiting, finish]);

  return (
    <div
      aria-busy={!exiting}
      aria-live="polite"
      className="fixed z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: '#0a0a0f',
        top: -1,
        left: -1,
        right: -1,
        bottom: -1,
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'scale(1.02)' : 'scale(1)',
        transition: `opacity ${EXIT_MS}ms ease-out, transform ${EXIT_MS}ms ease-out`,
        pointerEvents: exiting ? 'none' : 'auto',
      }}
    >
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(circle at 50% 45%, hsl(151 65% 30% / 0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <h1
          className="text-[3.5rem] font-black tracking-[0.2em] leading-none"
          style={{
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            background: 'linear-gradient(135deg, #ffffff 0%, hsl(151 65% 50%) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 2px 24px hsl(151 65% 35% / 0.25))',
          }}
        >
          SOCIVA
        </h1>
        <p
          className="text-[11px] font-medium tracking-[0.35em] uppercase"
          style={{
            color: 'hsl(151 30% 55%)',
            textShadow: '0 0 20px hsl(151 65% 30% / 0.3)',
          }}
        >
          Your Society, Your Store
        </p>
      </div>

      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 opacity-50">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: 'hsl(151 40% 45%)',
              animation: 'boot-pulse 1.2s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
