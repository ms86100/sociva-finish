// @ts-nocheck
import { useCallback, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  blurUpImageUrl,
  handleImageError,
  imageSrcSet,
  optimizedImageUrl,
} from '@/utils/imageHelpers';
import { durations, easings, imageReveal } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

export type MotionImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** Aspect ratio class on the frame, e.g. aspect-square or aspect-[4/3] */
  aspectClassName?: string;
  width?: number;
  quality?: number;
  sizes?: string;
  /** Low-res blur preview URL (optional); falls back to tiny optimized src */
  blurSrc?: string | null;
  loading?: 'lazy' | 'eager';
  /** Shown when src is missing or decode fails */
  fallback?: ReactNode;
  onLoad?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
};

/**
 * Aspect-locked image frame with branded shimmer while decoding,
 * optional blur-up, and opacity/scale reveal into the final photo.
 * Cached images that already have naturalWidth skip the shimmer flash.
 * Never invents product copy - only visual loading chrome.
 */
export function MotionImage({
  src,
  alt,
  className,
  imgClassName,
  aspectClassName = 'aspect-square',
  width = 400,
  quality = 78,
  sizes = '(max-width: 640px) 50vw, 240px',
  blurSrc,
  loading = 'lazy',
  fallback,
  onLoad,
  onError,
}: MotionImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const optimized = optimizedImageUrl(src, { width, quality });
  const srcSet = imageSrcSet(src, quality);
  const blur = blurSrc || blurUpImageUrl(src);

  const markLoaded = useCallback(() => {
    setLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleErr = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setFailed(true);
      if (onError) onError(e);
      else handleImageError(e);
      setLoaded(true);
    },
    [onError],
  );

  const showFallback = !optimized || failed;

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[hsl(var(--product-image-bg,var(--muted)))]',
        aspectClassName,
        className,
      )}
    >
      <AnimatePresence>
        {!loaded && !failed && optimized && (
          <motion.div
            key="shimmer"
            className="absolute inset-0 product-image-shimmer z-[1]"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: durations.fast } }}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {blur && !loaded && !failed && optimized && (
        <img
          src={blur}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover scale-105 blur-md opacity-70"
          decoding="async"
        />
      )}

      {showFallback ? (
        fallback ?? (
          <div className="absolute inset-0 product-image-shimmer" aria-hidden />
        )
      ) : (
        <motion.img
          src={optimized}
          srcSet={srcSet || undefined}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          loading={loading}
          decoding="async"
          ref={(el) => {
            // Cached images often skip a meaningful onLoad; avoid shimmer flash.
            if (el && el.complete && el.naturalWidth > 0 && !loaded) {
              markLoaded();
            }
          }}
          onLoad={markLoaded}
          onError={handleErr}
          variants={imageReveal}
          initial="hidden"
          animate={loaded ? 'show' : 'hidden'}
          transition={{ duration: durations.normal, ease: easings.easeOut }}
          className={cn('h-full w-full object-cover', imgClassName)}
        />
      )}
    </div>
  );
}
