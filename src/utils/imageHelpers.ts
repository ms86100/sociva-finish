// @ts-nocheck
/**
 * Image optimization helpers for Supabase Storage.
 * Appends transform params for WebP, quality, and width.
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
 * @example
 * optimizedImageUrl(url, { width: 300, quality: 75 })
 * // → "...?width=300&quality=75&format=webp"
 */
export function optimizedImageUrl(
  url: string | null | undefined,
  options?: ImageOptions
): string {
  if (!url) return '';

  // Only transform Supabase Storage URLs
  if (!url.includes(SUPABASE_STORAGE_HOST)) return url;

  const { width = 400, quality = 75, format = 'webp' } = options ?? {};

  // Replace /object/public/ with /render/image/public/ for transforms
  let transformUrl = url;
  if (url.includes('/object/public/')) {
    transformUrl = url.replace('/object/public/', '/render/image/public/');
  }

  const separator = transformUrl.includes('?') ? '&' : '?';
  return `${transformUrl}${separator}width=${width}&quality=${quality}&format=${format}`;
}

/**
 * Generates a srcSet string for responsive images.
 * Returns sizes at 150w, 300w, and 600w.
 */
export function imageSrcSet(
  url: string | null | undefined,
  quality = 75
): string {
  if (!url || !url.includes(SUPABASE_STORAGE_HOST)) return '';

  return [
    `${optimizedImageUrl(url, { width: 150, quality })} 150w`,
    `${optimizedImageUrl(url, { width: 300, quality })} 300w`,
    `${optimizedImageUrl(url, { width: 600, quality })} 600w`,
  ].join(', ');
}

/**
 * onError handler for optimized images.
 * First fallback: try the original (non-transformed) URL.
 * Second fallback: hide the image and show its sibling fallback.
 */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const src = img.src;

  // If currently using /render/image/, fall back to /object/public/ (original)
  if (src.includes('/render/image/public/')) {
    const original = src
      .replace('/render/image/public/', '/object/public/')
      .replace(/[?&](width|quality|format)=[^&]*/g, '')
      .replace(/\?$/, '');
    img.src = original;
    return;
  }

  // Final fallback: hide broken image, show parent's fallback content
  img.style.display = 'none';
}
