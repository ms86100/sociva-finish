// @ts-nocheck
/**
 * Image optimization helpers for Supabase Storage.
 * Scales by width only - CSS object-cover handles framing so we never stretch.
 */

interface ImageOptions {
  width?: number;
  quality?: number;
  format?: 'webp' | 'origin';
}

const SUPABASE_STORAGE_HOST = 'supabase.co/storage/v1';

/**
 * Returns an optimized image URL with Supabase Storage transform params.
 * Only applies to Supabase-hosted images. External URLs are returned as-is.
 *
 * Important: do NOT pass height here. Width-only keeps the native aspect ratio;
 * buyer cards use CSS object-cover + square frames (matching seller 1:1 crop).
 */
export function optimizedImageUrl(
  url: string | null | undefined,
  options?: ImageOptions
): string {
  if (!url) return '';

  if (!url.includes(SUPABASE_STORAGE_HOST)) return url;

  const { width = 400, quality = 75, format = 'webp' } = options ?? {};

  let transformUrl = url;
  if (url.includes('/object/public/')) {
    transformUrl = url.replace('/object/public/', '/render/image/public/');
  }

  const separator = transformUrl.includes('?') ? '&' : '?';
  return `${transformUrl}${separator}width=${width}&quality=${quality}&format=${format}`;
}

/**
 * Generates a srcSet string for responsive listing / menu thumbs.
 */
export function imageSrcSet(
  url: string | null | undefined,
  quality = 82
): string {
  if (!url || !url.includes(SUPABASE_STORAGE_HOST)) return '';

  return [160, 320, 480, 640]
    .map((w) => `${optimizedImageUrl(url, { width: w, quality })} ${w}w`)
    .join(', ');
}

/**
 * onError handler for optimized images.
 * First fallback: try the original (non-transformed) URL.
 * Second fallback: hide the image and show its sibling fallback.
 */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const src = img.src;

  if (src.includes('/render/image/public/')) {
    const original = src
      .replace('/render/image/public/', '/object/public/')
      .replace(/[?&](width|height|quality|format|resize)=[^&]*/g, '')
      .replace(/\?$/, '')
      .replace(/\?&/, '?')
      .replace(/&&+/g, '&');
    img.src = original;
    return;
  }

  img.style.display = 'none';
}
