import { type Variants, type Transition } from 'framer-motion';

// ─── Shared Motion Presets ───────────────────────────────────────────────────
// Used across all pages for consistent animation language.
// ALL app animations go through this file — no CSS keyframes for UI transitions.

// ─── Easing Presets ──────────────────────────────────────────────────────────
export const easings = {
  /** Smooth deceleration — default for most entrances */
  easeOut: [0.16, 1, 0.3, 1] as const,
  /** Gentle spring-like overshoot */
  spring: { type: 'spring' as const, stiffness: 260, damping: 24 },
  /** Snappy spring — buttons, toggles */
  snappy: { type: 'spring' as const, stiffness: 400, damping: 17 },
  /** Soft spring — overlays, modals */
  soft: { type: 'spring' as const, stiffness: 200, damping: 20 },
  /** Bouncy — celebration moments */
  bouncy: { type: 'spring' as const, stiffness: 300, damping: 12 },
};

// ─── Duration Constants ──────────────────────────────────────────────────────
export const durations = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
  stagger: 0.06,
};

// ─── Stagger Container ──────────────────────────────────────────────────────
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: durations.stagger },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

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

// ─── Progress Bar Spring ─────────────────────────────────────────────────────
export const progressSpring: Transition = {
  type: 'spring',
  stiffness: 80,
  damping: 15,
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

// ─── Skeleton Shimmer Transition ─────────────────────────────────────────────
export const skeletonToContent: Variants = {
  skeleton: { opacity: 1 },
  loaded: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
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

// ─── Stagger Grid (slightly slower stagger for grid layouts) ─────────────────
export const staggerGrid: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};
