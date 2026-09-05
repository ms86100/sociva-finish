/**
 * Client-side image dimension checks shared by upload widgets.
 * Product photos require a usable resolution so 1×1 / 10×10 test assets are rejected.
 */

export const PRODUCT_IMAGE_MIN_PX = 400;
export const PRODUCT_IMAGE_MAX_PX = 4000;

export type ImageDimensionResult =
  | { ok: true; width: number; height: number }
  | { ok: false; width: number; height: number; reason: 'too_small' | 'too_large' | 'unreadable' };

export function readImageDimensions(source: Blob | File | string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let objectUrl: string | null = null;
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}

export async function validateProductImageDimensions(
  source: Blob | File | string,
  minPx = PRODUCT_IMAGE_MIN_PX,
  maxPx = PRODUCT_IMAGE_MAX_PX,
): Promise<ImageDimensionResult> {
  const dims = await readImageDimensions(source);
  if (!dims) return { ok: false, width: 0, height: 0, reason: 'unreadable' };
  if (dims.width < minPx || dims.height < minPx) {
    return { ok: false, width: dims.width, height: dims.height, reason: 'too_small' };
  }
  if (dims.width > maxPx || dims.height > maxPx) {
    return { ok: false, width: dims.width, height: dims.height, reason: 'too_large' };
  }
  return { ok: true, width: dims.width, height: dims.height };
}

export function productImageDimensionError(result: ImageDimensionResult, minPx = PRODUCT_IMAGE_MIN_PX, maxPx = PRODUCT_IMAGE_MAX_PX): string | null {
  if (result.ok) return null;
  if (result.reason === 'too_small') {
    return `Image must be at least ${minPx}×${minPx}px. Yours is ${result.width}×${result.height}px.`;
  }
  if (result.reason === 'too_large') {
    return `Image must be at most ${maxPx}×${maxPx}px. Yours is ${result.width}×${result.height}px.`;
  }
  return 'Could not read image dimensions. Try another photo.';
}
