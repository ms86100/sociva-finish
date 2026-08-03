import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { hideSplashScreen } from '@/lib/capacitor';

const MIN_DISPLAY_MS = 700;
const MAX_DISPLAY_MS = 2500;

interface AppSplashScreenProps {
  ready: boolean;
  onComplete: () => void;
}

export function AppSplashScreen({ ready, onComplete }: AppSplashScreenProps) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const mountTime = useRef(Date.now());
  const completedRef = useRef(false);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    const bootTime = Date.now() - mountTime.current;
    console.log(`[Splash] Total display time: ${bootTime}ms`);
    onComplete();
  }, [onComplete]);

  // Hide native splash as soon as web splash mounts
  useEffect(() => {
    hideSplashScreen();
  }, []);

  // Min display timer
  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Hard cap — force exit + complete so a stuck overlay can't block the app (DEF-008)
  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), MAX_DISPLAY_MS);
    const forceTimer = setTimeout(finish, MAX_DISPLAY_MS + 500);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(forceTimer);
    };
  }, [finish]);

  // Begin exit when ready + min elapsed
  useEffect(() => {
    if (ready && minElapsed && !exiting) {
      setExiting(true);
    }
  }, [ready, minElapsed, exiting]);

  return (
    <AnimatePresence onExitComplete={finish}>
      {!exiting && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="fixed z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{ backgroundColor: '#0a0a0f', top: -1, left: -1, right: -1, bottom: -1 }}
        >
          {/* Subtle radial glow behind text */}
          <div 
            className="absolute inset-0 opacity-30"
            style={{
              background: 'radial-gradient(circle at 50% 45%, hsl(151 65% 30% / 0.15) 0%, transparent 60%)'
            }}
          />

          {/* Brand text — SOCIVA */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex flex-col items-center gap-4"
          >
            {/* SOCIVA wordmark */}
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

            {/* Tagline */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.7, ease: 'easeOut' }}
              className="text-[11px] font-medium tracking-[0.35em] uppercase"
              style={{ 
                color: 'hsl(151 30% 55%)',
                textShadow: '0 0 20px hsl(151 65% 30% / 0.3)'
              }}
            >
              Your Society, Your Store
            </motion.p>
          </motion.div>

          {/* Subtle loading indicator — positioned at bottom */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-1.5 z-10"
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: 'hsl(151 40% 45%)' }}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
