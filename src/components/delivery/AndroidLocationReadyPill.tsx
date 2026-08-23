import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { Navigation } from 'lucide-react';
import { easings } from '@/lib/motion-variants';

/**
 * Android-only celebration pill when live location sharing starts.
 * Mirrors the native MainActivity branded pill so GPS start feels polished
 * (never like a license/error toast).
 */
export function AndroidLocationReadyPill({
  active,
  title = 'Live location on',
  subtitle = 'Buyers can follow this delivery in real time',
}: {
  active: boolean;
  title?: string;
  subtitle?: string;
}) {
  const isAndroid = Capacitor.getPlatform() === 'android';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isAndroid || !active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 3200);
    return () => window.clearTimeout(t);
  }, [active, isAndroid]);

  if (!isAndroid) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-5"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
          initial={{ opacity: 0, y: 28, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.45, ease: easings.easeOut }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/15 px-4 py-3.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
            style={{
              background:
                'linear-gradient(135deg, rgba(42,42,69,0.96) 0%, rgba(26,26,46,0.98) 48%, rgba(22,32,50,0.96) 100%)',
            }}
          >
            <motion.div
              className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-sky-400/20 blur-2xl"
              animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.15, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative flex items-center gap-3">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <motion.span
                  className="absolute inset-0 rounded-full bg-sky-400/30"
                  animate={{ scale: [1, 1.35, 1], opacity: [0.55, 0.15, 0.55] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sky-100">
                  <Navigation size={15} strokeWidth={2.25} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium tracking-tight text-[#F7F8FC]">{title}</p>
                <p className="mt-0.5 text-xs text-[#C8D0E0]/subtitle}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
