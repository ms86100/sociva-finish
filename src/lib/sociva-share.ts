/**
 * Cross-platform Sociva share helpers (Web Share / clipboard / WhatsApp).
 * Share links use /api/share/* so WhatsApp can read Open Graph tags (hash URLs cannot).
 */

const PUBLIC_ORIGIN = 'https://www.sociva.in';

export function getPublicOrigin(): string {
  if (typeof window === 'undefined') return PUBLIC_ORIGIN;
  const origin = window.location.origin;
  if (
    !origin ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin.startsWith('https://localhost')
  ) {
    return PUBLIC_ORIGIN;
  }
  return origin;
}

/** Path-based share URL with server OG tags → redirects humans into the hash app. */
export function productShareUrl(productId: string): string {
  return `${getPublicOrigin()}/api/share/product/${encodeURIComponent(productId)}`;
}

export function storeShareUrl(sellerId: string): string {
  return `${getPublicOrigin()}/api/share/store/${encodeURIComponent(sellerId)}`;
}

/** Deep link opened inside the SPA after OG bounce. */
export function productAppDeepLink(productId: string): string {
  return `${getPublicOrigin()}/#/product/${encodeURIComponent(productId)}`;
}

export function storeAppDeepLink(sellerId: string): string {
  return `${getPublicOrigin()}/#/seller/${encodeURIComponent(sellerId)}`;
}

export function buildProductShareText(opts: {
  name: string;
  priceLabel: string;
  sellerName: string;
  url: string;
}): string {
  const name = (opts.name || 'Product').trim();
  const seller = (opts.sellerName || 'a neighbour').trim();
  const price = (opts.priceLabel || '').trim();
  const priceLine = price ? `${name} — ${price}` : name;
  return [
    '*Found this on Sociva!*',
    priceLine,
    `From ${seller}`,
    '',
    'Check it out and order directly on Sociva:',
    opts.url,
  ].join('\n');
}

export function buildStoreShareText(opts: {
  storeName: string;
  url: string;
}): string {
  const store = (opts.storeName || 'my store').trim();
  return [
    `*Check out ${store} on Sociva!*`,
    'Fresh listings from your neighbourhood marketplace.',
    '',
    'Browse & order on Sociva:',
    opts.url,
  ].join('\n');
}

export type ShareResult = 'shared' | 'copied' | 'whatsapp' | 'cancelled' | 'failed';

async function tryShareWithImage(opts: {
  title: string;
  text: string;
  url: string;
  imageUrl?: string | null;
}): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  const imageUrl = opts.imageUrl?.trim();
  if (!imageUrl) return false;

  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return false;
    const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    const file = new File([blob], `sociva-share.${ext}`, { type: blob.type || 'image/jpeg' });
    const data: ShareData = {
      title: opts.title,
      text: opts.text,
      files: [file],
    };
    if (navigator.canShare && !navigator.canShare(data)) return false;
    await navigator.share(data);
    return true;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return false;
  }
}

async function tryNativeShare(opts: { title: string; text: string; url: string }): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  // Prefer a single text payload (includes URL) — more reliable on iOS/Android WhatsApp.
  const payloads: ShareData[] = [
    { title: opts.title, text: opts.text },
    { title: opts.title, text: opts.text, url: opts.url },
    { title: opts.title, url: opts.url },
  ];
  for (const data of payloads) {
    try {
      if (navigator.canShare && !navigator.canShare(data)) continue;
      await navigator.share(data);
      return true;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
    }
  }
  return false;
}

export async function shareSocivaContent(opts: {
  title: string;
  text: string;
  url: string;
  imageUrl?: string | null;
}): Promise<ShareResult> {
  try {
    if (await tryShareWithImage(opts)) return 'shared';
    if (await tryNativeShare(opts)) return 'shared';
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'cancelled';
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(opts.text);
      return 'copied';
    }
  } catch {
    // fall through to WhatsApp
  }

  try {
    const wa = `https://wa.me/?text=${encodeURIComponent(opts.text)}`;
    window.open(wa, '_blank', 'noopener,noreferrer');
    return 'whatsapp';
  } catch {
    return 'failed';
  }
}
