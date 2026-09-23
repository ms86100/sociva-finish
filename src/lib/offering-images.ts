/** Shared Product / Service / Listing gallery: image_url + secondary_images. */

export const MIN_OFFERING_IMAGES = 1;
export const MAX_OFFERING_IMAGES = 5;
/** secondary_images may hold at most this many extras (primary lives in image_url). */
export const MAX_SECONDARY_IMAGES = MAX_OFFERING_IMAGES - 1;

export type OfferingImageSource = {
  image_url?: string | null;
  secondary_images?: string[] | null;
};

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Ordered unique gallery URLs (primary first), capped at MAX_OFFERING_IMAGES. */
export function resolveOfferingImages(source: OfferingImageSource | null | undefined): string[] {
  if (!source) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url)) return;
    if (out.length >= MAX_OFFERING_IMAGES) return;
    seen.add(url);
    out.push(url);
  };
  push(source.image_url);
  const secondary = Array.isArray(source.secondary_images) ? source.secondary_images : [];
  for (const item of secondary) push(item);
  return out;
}

/** Split gallery URLs into primary image_url + secondary_images (max 4). */
export function splitOfferingImages(urls: string[]): {
  image_url: string | null;
  secondary_images: string[];
} {
  const resolved = resolveOfferingImages({
    image_url: urls[0] ?? null,
    secondary_images: urls.slice(1),
  });
  if (resolved.length === 0) {
    return { image_url: null, secondary_images: [] };
  }
  return {
    image_url: resolved[0],
    secondary_images: resolved.slice(1, MAX_OFFERING_IMAGES),
  };
}

export function canAddOfferingImage(currentCount: number): boolean {
  return currentCount < MAX_OFFERING_IMAGES;
}

export function canRemoveOfferingImage(currentCount: number): boolean {
  return currentCount > MIN_OFFERING_IMAGES;
}

/** Primary cover URL for cards / cart thumbs. */
export function primaryOfferingImage(source: OfferingImageSource | null | undefined): string | null {
  const images = resolveOfferingImages(source);
  return images[0] ?? null;
}

export function offeringImagesLabel(count: number): string {
  if (count <= 0) return 'Add up to 5 photos';
  if (count >= MAX_OFFERING_IMAGES) return `${MAX_OFFERING_IMAGES} photos (maximum)`;
  return `${count} of ${MAX_OFFERING_IMAGES} photos · Add up to 5 photos`;
}
