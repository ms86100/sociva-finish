// @ts-nocheck
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easings } from '@/lib/motion-variants';
import { hapticNotification } from '@/lib/haptics';

export const FEEDBACK_AUTO_DISMISS_MS = 2800;

interface FeedbackPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  variant?: 'success' | 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

const COPY_HINTS = [
  { match: /product image uploaded|image uploaded successfully/i, heading: 'Photo saved', body: 'Your product image is ready to use.' },
  { match: /product saved successfully|product added/i, heading: 'Product saved', body: 'Buyers will see this on your store.' },
  { match: /product updated/i, heading: 'Changes saved', body: 'Your listing is up to date.' },
  { match: /product deleted/i, heading: 'Product removed', body: 'It is no longer listed on your store.' },
  { match: /invite link copied|store link copied|link copied|copied to clipboard|copied!/i, heading: 'Link copied', body: 'Share it with your neighbor whenever you are ready.' },
  { match: /address saved/i, heading: 'Address saved', body: 'We will use this for deliveries.' },
  { match: /profile updated/i, heading: 'Profile updated', body: 'You are all set.' },
  { match: /submitted for approval/i, heading: 'Sent for review', body: 'We will notify you once it is approved.' },
  { match: /thank you for your feedback|feedback received/i, heading: 'Feedback received', body: 'Thank you. This helps us improve Sociva.' },
  { match: /added to cart/i, heading: 'Added to cart', body: 'You can review it anytime in your cart.' },
  { match: /removed from cart/i, heading: 'Removed from cart', body: 'The item is no longer in your cart.' },
  { match: /quantity updated/i, heading: 'Quantity updated', body: 'Your cart has been updated.' },
];

function stripBrokenGlyphs(value: string) {
  return (value || '')
    .replace(/\uFFFD/g, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function presentCopy(title: string, description?: string) {
  const raw = stripBrokenGlyphs(title);
  const isFailure = /fail|error|denied|already exists|could not|can't find/i.test(raw);
  const hint = !isFailure ? COPY_HINTS.find((h) => h.match.test(raw)) : undefined;

  return {
    heading: hint?.heading || raw,
    body: stripBrokenGlyphs(description || '') || hint?.body || '',
  };
}

const SPARKS = [
  { x: -52, y: -34, delay: 0 },
  { x: 54, y: -28, delay: 0.06 },
  { x: -40, y: 40, delay: 0.1 },
  { x: 46, y: 36, delay: 0.14 },
  { x: 0, y: -52, delay: 0.04 },
  { x: 66, y: 8, delay: 0.18 },
];

export function FeedbackPopup({
  isOpen,
  onClose,
  title,
  description,
  variant = 'success',
  actionLabel,
  onAction,
}: FeedbackPopupProps) {
  const { heading, body } = presentCopy(title, description);
  const autoDismiss = !actionLabel;

  useEffect(() => {
    if (!isOpen) return;
    hapticNotification(variant === 'warning' ? 'warning' : 'success');
  }, [isOpen, variant, title]);

  if (!isOpen) return null;

  const tone = {
    success: {
      glow: 'shadow-[0_24px_60px_-18px_hsl(var(--success)/0.45)]',
      ring: 'from-success/25 via-primary/15 to-transparent',
      iconWrap: 'bg-gradient-to-br from-success to-primary text-primary-foreground',
      bar: 'bg-success',
      Icon: Check,
    },
    warning: {
      glow: 'shadow-[0_24px_60px_-18px_hsl(var(--warning)/0.4)]',
      ring: 'from-warning/30 via-warning/10 to-transparent',
      iconWrap: 'bg-gradient-to-br from-warning to-orange-500 text-white',
      bar: 'bg-warning',
      Icon: AlertTriangle,
    },
    info: {
      glow: 'shadow-[0_24px_60px_-18px_hsl(var(--info)/0.4)]',
      ring: 'from-info/25 via-primary/10 to-transparent',
      iconWrap: 'bg-gradient-to-br from-info to-primary text-white',
      bar: 'bg-info',
      Icon: Info,
    },
  }[variant] || {
    glow: 'shadow-[0_24px_60px_-18px_hsl(var(--success)/0.45)]',
    ring: 'from-success/25 via-primary/15 to-transparent',
    iconWrap: 'bg-gradient-to-br from-success to-primary text-primary-foreground',
    bar: 'bg-success',
    Icon: Check,
  };

  const ToneIcon = tone.Icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        'fixed inset-0 z-[250] flex items-center justify-center px-6',
        actionLabel ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      role="status"
      aria-live="polite"
      aria-label={heading}
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--foreground)/0.16),transparent_62%)]"
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={easings.soft}
        className={cn(
          'relative pointer-events-auto w-[min(20.5rem,calc(100vw-2.5rem))] overflow-hidden rounded-[1.75rem]',
          'bg-card text-card-foreground border border-border/80',
          tone.glow,
        )}
      >
        <div className={cn('pointer-events-none absolute -top-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full bg-gradient-to-b blur-2xl', tone.ring)} />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="relative px-6 pb-5 pt-7 text-center">
          <div className="relative mx-auto mb-4 flex h-[4.5rem] w-[4.5rem] items-center justify-center">
            {variant === 'success' && SPARKS.map((spark) => (
              <motion.span
                key={`${spark.x}-${spark.y}`}
                initial={{ opacity: 0, scale: 0.3, x: 0, y: 0 }}
                animate={{ opacity: [0, 0.9, 0], scale: [0.3, 1, 0.6], x: spark.x, y: spark.y }}
                transition={{ duration: 0.65, delay: spark.delay, ease: easings.easeOut }}
                className="absolute h-1.5 w-1.5 rounded-full bg-primary"
                aria-hidden
              />
            ))}

            <motion.div
              initial={{ scale: 0.7 }}
              animate={{ scale: 1 }}
              transition={easings.soft}
              className={cn('relative flex h-14 w-14 items-center justify-center rounded-full shadow-md', tone.iconWrap)}
            >
              <ToneIcon className="h-7 w-7" strokeWidth={2.6} />
            </motion.div>
          </div>

          <motion.h3
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.28, ease: easings.easeOut }}
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            {heading}
          </motion.h3>

          {body ? (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.28, ease: easings.easeOut }}
              className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
            >
              {body}
            </motion.p>
          ) : null}

          {actionLabel && onAction ? (
            <motion.button
              type="button"
              onClick={() => {
                onAction();
                onClose();
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.28, ease: easings.easeOut }}
              className="mt-4 w-full rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-cta active:scale-[0.98] transition-transform"
            >
              {actionLabel}
            </motion.button>
          ) : null}
        </div>

        {autoDismiss ? (
          <div className="h-1 w-full bg-muted/70">
            <motion.div
              className={cn('h-full origin-left', tone.bar)}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: FEEDBACK_AUTO_DISMISS_MS / 1000, ease: 'linear' }}
            />
          </div>
        ) : (
          <div className="h-1 w-full bg-muted/40" />
        )}
      </motion.div>
    </motion.div>
  );
}
