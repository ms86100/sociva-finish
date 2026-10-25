/**
 * Cross-platform Sociva share helpers (WhatsApp / Web Share / clipboard).
 * Share links use /api/share/* so WhatsApp can read Open Graph tags (hash URLs cannot).
 *
 * WhatsApp must be opened with the native `whatsapp://send?text=` scheme so the OS
 * hands the prefilled message to the contact picker. Loading the WhatsApp https
 * landing page inside an in-app browser / Custom Tabs / SFSafariViewController
 * shows an "Open WhatsApp" interstitial that launches the app without the text.
 */

import { Capacitor } from '@capacitor/core';

const PUBLIC_ORIGIN = 'https://www.sociva.in';
const WHATSAPP_HANDOFF_MS = 1200;

function isStagingAppEnv(): boolean {
  const appEnv = String(import.meta.env.VITE_APP_ENV || '')
    .toLowerCase()
    .trim();
  return appEnv === 'staging' || appEnv === 'test';
}

export function getPublicOrigin(): string {
  if (typeof window === 'undefined') return PUBLIC_ORIGIN;

  const stagingOrigin = String(import.meta.env.VITE_PUBLIC_ORIGIN || '')
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/\/$/, '');
  if (isStagingAppEnv() && stagingOrigin && /^https?:\/\//i.test(stagingOrigin)) {
    return stagingOrigin;
  }

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
  // ?og=1 busts stale WhatsApp/home OG cache from when /api/share served the SPA
  return `${getPublicOrigin()}/api/share/product/${encodeURIComponent(productId)}?og=1`;
}

export function storeShareUrl(sellerId: string): string {
  return `${getPublicOrigin()}/api/share/store/${encodeURIComponent(sellerId)}?og=1`;
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
  const priceLine = price ? `${name} - ${price}` : name;
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

/** Native WhatsApp contact-picker URL. The text query is a single encodeURIComponent of the full message. */
export function buildWhatsAppSchemeUrl(text: string): string {
  return `whatsapp://send?text=${encodeURIComponent(text)}`;
}

/** https fallback for browsers only. Never load this inside Capacitor Browser. */
export function buildWhatsAppHttpsUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export type ShareResult = 'shared' | 'copied' | 'whatsapp' | 'cancelled' | 'failed';

/** Test seam so unit tests can intercept OS handoff without touching window.location. */
export const shareBridge = {
  assignLocation(url: string) {
    window.location.assign(url);
  },
  openBlank(url: string): Window | null {
    return window.open(url, '_blank', 'noopener,noreferrer');
  },
  isDocumentHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  },
};

function waitForAppHandoff(timeoutMs: number): Promise<boolean> {
  if (shareBridge.isDocumentHidden()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') finish(true);
    };
    const onHide = () => finish(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

async function tryOpenWhatsApp(text: string): Promise<boolean> {
  const schemeUrl = buildWhatsAppSchemeUrl(text);
  const httpsUrl = buildWhatsAppHttpsUrl(text);

  if (Capacitor.isNativePlatform()) {
    try {
      const handoff = waitForAppHandoff(WHATSAPP_HANDOFF_MS);
      shareBridge.assignLocation(schemeUrl);
      return await handoff;
    } catch (err) {
      console.error('[sociva-share] WhatsApp scheme open failed', err);
      return false;
    }
  }

  try {
    const opened = shareBridge.openBlank(httpsUrl);
    return !!opened;
  } catch (err) {
    console.error('[sociva-share] WhatsApp window.open failed', err);
    return false;
  }
}

async function tryCapacitorShare(opts: {
  title: string;
  text: string;
  url: string;
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { Share } = await import('@capacitor/share');
    // Text already includes the canonical URL. Passing `url` as well makes the
    // Android plugin append it a second time.
    await Share.share({
      title: opts.title,
      text: opts.text,
      dialogTitle: opts.title,
    });
    return true;
  } catch (err) {
    const message = String((err as Error)?.message || err || '');
    if (/cancel|abort|dismiss/i.test(message)) {
      throw Object.assign(new Error(message), { name: 'AbortError' });
    }
    console.error('[sociva-share] Capacitor Share failed', err);
    return false;
  }
}

async function tryCapacitorClipboard(text: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
    return true;
  } catch (err) {
    console.error('[sociva-share] Capacitor Clipboard failed', err);
    return false;
  }
}

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
  // Prefer a single text payload (includes URL) - more reliable on iOS/Android WhatsApp.
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

async function tryShareSheet(opts: {
  title: string;
  text: string;
  url: string;
  imageUrl?: string | null;
}): Promise<boolean> {
  if (await tryCapacitorShare(opts)) return true;
  if (await tryShareWithImage(opts)) return true;
  if (await tryNativeShare(opts)) return true;
  return false;
}

export async function shareSocivaContent(opts: {
  title: string;
  text: string;
  url: string;
  imageUrl?: string | null;
}): Promise<ShareResult> {
  const native = Capacitor.isNativePlatform();

  // Native apps: open WhatsApp with the prefilled composer, then the OS share sheet.
  // Web: prefer the browser share sheet, then wa.me in a new tab (never an in-app browser).
  const first = native ? () => tryOpenWhatsApp(opts.text) : () => tryShareSheet(opts);
  const second = native ? () => tryShareSheet(opts) : () => tryOpenWhatsApp(opts.text);

  try {
    if (await first()) return native ? 'whatsapp' : 'shared';
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'cancelled';
    console.error('[sociva-share] primary share path failed', err);
  }

  try {
    if (await second()) return native ? 'shared' : 'whatsapp';
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'cancelled';
    console.error('[sociva-share] fallback share path failed', err);
  }

  try {
    if (await tryCapacitorClipboard(opts.text)) return 'copied';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(opts.text);
      return 'copied';
    }
  } catch (err) {
    console.error('[sociva-share] Clipboard write failed', err);
  }

  return 'failed';
}
