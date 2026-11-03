// @ts-nocheck
import { useCallback, useState } from 'react';
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
  /** Aspect ratio class on the frame, e.g. aspect-square */
  aspectClassName?: string;
  width?: number;
  sizes?: string;
  /** Low-res blur preview URL (optional); falls back to tiny optimized src */
  blurSrc?: string | null;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
};

/**
 * Aspect-locked image frame with branded shimmer while decoding,
 * optional blur-up, and opacity/scale reveal into the final photo.
 * Never invents product copy - only visual loading chrome.
 */
export function MotionImage({
  src,
  alt,
  className,
  imgClassName,
  aspectClassName = 'aspect-square',
  width = 400,
  sizes = '(max-width: 640px) 50vw, 240px',
  blurSrc,
  loading = 'lazy',
  onLoad,
  onError,
}: MotionImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const optimized = optimizedImageUrl(src, { width, quality: 78 });
  const srcSet = imageSrcSet(src);
  const blur = blurSrc || blurUpImageUrl(src);

  const handleLoad = useCallback(() => {
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

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[hsl(var(--product-image-bg,var(--muted)))]',
        aspectClassName,
        className,
      )}
    >
      <AnimatePresence>
        {!loaded && !failed && (
          <motion.div
            key="shimmer"
            className="absolute inset-0 product-image-shimmer z-[1]"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: durations.fast } }}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {blur && !loaded && !failed && (
        <img
          src={blur}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover scale-105 blur-md opacity-70"
          decoding="async"
        />
      )}

      {optimized ? (
        <motion.img
          src={optimized}
          srcSet={srcSet || undefined}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={handleLoad}
          onError={handleErr}
          variants={imageReveal}
          initial="hidden"
          animate={loaded ? 'show' : 'hidden'}
          transition={{ duration: durations.normal, ease: easings.easeOut }}
          className={cn('h-full w-full object-cover', imgClassName)}
        />
      ) : (
        <div className="absolute inset-0 product-image-shimmer" aria-hidden />
      )}
    </div>
  );
}
