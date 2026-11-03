import { type Variants, type Transition } from 'framer-motion';
import { durations, easings, progressSpring, staggerDelay, travelY } from './tokens';

export { progressSpring };

// ─── Stagger Container ──────────────────────────────────────────────────────
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    // Keep marketplace grids snappy; long cascades feel artificial on mobile.
    transition: { staggerChildren: durations.stagger, staggerDirection: 1 },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

/** Grid stagger that uses native-aware delay when evaluated at runtime via getStaggerGrid */
export const staggerGrid: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.02 },
  },
};

export function getStaggerGrid(): Variants {
  return {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: staggerDelay() },
    },
  };
}

// ─── Card Entrance ───────────────────────────────────────────────────────────
export const cardEntrance: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: easings.spring,
  },
};

export function getCardEntrance(): Variants {
  const y = travelY(16, 10);
  return {
    hidden: { opacity: 0, y, scale: 0.98 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: easings.spring,
    },
  };
}

// ─── Status Transition (for badge/status changes) ────────────────────────────
export const statusTransition: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

// ─── Scale Press (micro-interaction for tappable elements) ───────────────────
export const scalePress = {
  whileTap: { scale: 0.96 },
  transition: easings.snappy,
};

// ─── Button Press (slightly more pronounced) ─────────────────────────────────
export const buttonPress = {
  whileTap: { scale: 0.95 },
  whileHover: { scale: 1.02 },
  transition: easings.snappy,
};

// ─── Glass Fade In ───────────────────────────────────────────────────────────
export const glassFadeIn: Variants = {
  hidden: { opacity: 0, scale: 0.95, filter: 'blur(4px)' },
  show: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: easings.soft,
  },
};

// ─── Slide Up (modals, sheets) ───────────────────────────────────────────────
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 28 },
  },
  exit: { opacity: 0, y: 24 },
};

export const modalTransition: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: travelY(12, 8) },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: easings.soft,
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 8,
    transition: { duration: durations.fast },
  },
};

export const bottomSheetTransition: Variants = {
  hidden: { opacity: 0, y: '100%' },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 320, damping: 32 },
  },
  exit: {
    opacity: 0,
    y: '40%',
    transition: { duration: durations.normal },
  },
};

// ─── Fade In (generic) ──────────────────────────────────────────────────────
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: durations.normal },
  },
  exit: { opacity: 0, transition: { duration: durations.fast } },
};

// ─── Fade Slide Up (sections, lazy content) ──────────────────────────────────
export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.slow },
  },
};

// ─── Scale In (popovers, tooltips) ───────────────────────────────────────────
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: {
    opacity: 1,
    scale: 1,
    transition: easings.snappy,
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: durations.fast },
  },
};

// ─── List Item (for staggered list rendering) ────────────────────────────────
export const listItem: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: {
    opacity: 1,
    x: 0,
    transition: easings.spring,
  },
};

// ─── Tab Content (smooth tab switch) ─────────────────────────────────────────
export const tabContent: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.normal },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: durations.fast },
  },
};

// ─── Filter Chip ─────────────────────────────────────────────────────────────
export const filterChip: Variants = {
  inactive: { scale: 1 },
  active: {
    scale: 1,
    transition: easings.snappy,
  },
};

// ─── Empty State ─────────────────────────────────────────────────────────────
export const emptyState: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { ...easings.soft, delay: 0.1 },
  },
};

// ─── Notification Badge Pop ──────────────────────────────────────────────────
export const badgePop: Variants = {
  hidden: { scale: 0, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: easings.bouncy,
  },
};

// ─── Image Hover (product cards) ─────────────────────────────────────────────
export const imageHover = {
  whileHover: { scale: 1.04 },
  transition: { duration: 0.3 },
};

export const imageReveal: Variants = {
  hidden: { opacity: 0, scale: 1.02 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: durations.normal, ease: easings.easeOut },
  },
};

// ─── Skeleton Shimmer Transition ─────────────────────────────────────────────
export const skeletonToContent: Variants = {
  skeleton: { opacity: 1 },
  loaded: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
};

export const contentCrossfade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: durations.normal } },
  exit: { opacity: 0, transition: { duration: durations.fast } },
};

// ─── Page Transition ─────────────────────────────────────────────────────────
export const pageTransition: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: durations.normal },
  },
  exit: {
    opacity: 0,
    transition: { duration: durations.fast },
  },
};

// ─── Slide From Left ─────────────────────────────────────────────────────────
export const slideFromLeft: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: easings.spring,
  },
};

// ─── Pulse Ring (attention-drawing infinite pulse) ───────────────────────────
export const pulseRing: Variants = {
  idle: { scale: 1 },
  pulse: {
    scale: [1, 1.06, 1],
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
  },
};

// ─── Discovery moment - slow floating cards / orbit icons ────────────────────
export const floatSlow: Variants = {
  animate: {
    y: [0, -4, 0, 3, 0],
    transition: { duration: 7, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const orbitBob: Variants = {
  animate: (i: number = 0) => ({
    y: [0, -3, 0, 2, 0],
    transition: {
      duration: 4.5 + (i % 3) * 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: (i % 4) * 0.25,
    },
  }),
};

export const discoveryPulse: Variants = {
  animate: {
    scale: [1, 1.35, 1],
    opacity: [0.45, 0, 0.45],
    transition: { duration: 2.4, repeat: Infinity, ease: 'easeOut' },
  },
};

/** Quantity stepper micro-pop */
export const qtyPop: Variants = {
  initial: { scale: 0.85, opacity: 0.6 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: easings.snappy,
  },
};

export type { Variants, Transition };
