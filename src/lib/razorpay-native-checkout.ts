import { Capacitor } from '@capacitor/core';
import { isLikelyRazorpayNode } from '@/lib/razorpay-checkout-dom';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response?: { error?: unknown }) => void) => void;
    };
  }
}

export const RAZORPAY_CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

export type RazorpayNativeLayout = 'android-fullscreen' | 'ios-fullscreen' | null;

export type RazorpayCheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayNativeLayoutOptions = {
  key: string;
  amount: number;
  currency?: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: Record<string, string>;
  notes?: Record<string, unknown>;
  theme?: { color?: string };
  handler: (response: RazorpayCheckoutSuccess) => void;
  onDismiss?: () => void;
  onFailure?: (error: unknown) => void;
};

let razorpayDomObserver: MutationObserver | null = null;
let razorpayLayoutResync: (() => void) | null = null;

export function getRazorpayNativeLayout(): RazorpayNativeLayout {
  if (!Capacitor.isNativePlatform()) return null;
  return Capacitor.getPlatform() === 'ios' ? 'ios-fullscreen' : 'android-fullscreen';
}

/**
 * Native Checkout.js overlays are injected as body children and ignore React
 * SafeHeader padding. Capacitor overlays the WebView under the system bars
 * (`StatusBar.overlaysWebView` + iOS `contentInset: never`), so the overlay
 * must be inset with --app-safe-* / env(safe-area-inset-*).
 *
 * Do not set top/height/padding here — CSS on body.razorpay-ios/android is
 * the source of truth. Inline padding:0 would hide the status-bar inset.
 */
export function applyNativeCheckoutLayout(node: HTMLElement, layout: RazorpayNativeLayout) {
  if (!layout) return;
  if (node.parentElement !== document.body) return;
  if (!isLikelyRazorpayNode(node)) return;

  node.style.setProperty('position', 'fixed', 'important');
  node.style.setProperty('left', '0', 'important');
  node.style.setProperty('right', '0', 'important');
  node.style.setProperty('width', '100%', 'important');
  node.style.setProperty('overflow', 'hidden', 'important');
  node.style.setProperty('background-color', '#fff', 'important');
  node.style.setProperty('box-sizing', 'border-box', 'important');
}

export function startSafeAreaObserver(onDetected?: () => void) {
  stopSafeAreaObserver();
  const layout = getRazorpayNativeLayout();

  const patchNode = (node: HTMLElement) => {
    if (!isLikelyRazorpayNode(node)) return;
    onDetected?.();
    applyNativeCheckoutLayout(node, layout);
  };

  razorpayDomObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added instanceof HTMLElement) patchNode(added);
      }
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        patchNode(mutation.target);
      }
    }
  });

  razorpayDomObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  const resync = () => {
    document.body.querySelectorAll<HTMLElement>('div').forEach(patchNode);
  };
  razorpayLayoutResync = resync;
  window.addEventListener('orientationchange', resync);
  window.addEventListener('resize', resync);
  document.body.querySelectorAll<HTMLElement>('div').forEach(patchNode);
}

export function stopSafeAreaObserver() {
  if (razorpayDomObserver) {
    razorpayDomObserver.disconnect();
    razorpayDomObserver = null;
  }
  if (razorpayLayoutResync) {
    window.removeEventListener('orientationchange', razorpayLayoutResync);
    window.removeEventListener('resize', razorpayLayoutResync);
    razorpayLayoutResync = null;
  }
}

export function lockBodyForCheckout() {
  const scrollY = window.scrollY;
  document.body.dataset.scrollY = String(scrollY);
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('razorpay-active');
  document.body.classList.remove('razorpay-android', 'razorpay-ios');
  const layout = getRazorpayNativeLayout();
  if (layout === 'android-fullscreen') document.body.classList.add('razorpay-android');
  if (layout === 'ios-fullscreen') document.body.classList.add('razorpay-ios');
}

export function unlockBodyScroll() {
  stopSafeAreaObserver();
  document.body.classList.remove('razorpay-active', 'razorpay-android', 'razorpay-ios');
  document.body.style.removeProperty('top');
  const savedY = parseInt(document.body.dataset.scrollY || '0', 10);
  window.scrollTo(0, savedY);
  delete document.body.dataset.scrollY;
}

/**
 * Standard Checkout options that keep UPI Intent apps visible inside a
 * Capacitor WebView. `show_default_blocks: false` collapses UPI to collect-only
 * (enter VPA). Intent + collect are both listed so GPay/PhonePe/Paytm appear
 * when the OS can see those apps.
 */
export function razorpayNativeCheckoutOptions() {
  return {
    webview_intent: true,
    _: {
      payment: { redirect: false },
    },
    method: {
      upi: true,
      card: true,
      netbanking: true,
      wallet: true,
    },
    config: {
      display: {
        blocks: {
          upi_apps: {
            name: 'Pay using UPI apps',
            instruments: [{ method: 'upi', flows: ['intent'] }],
          },
          upi_id: {
            name: 'Pay using UPI ID',
            instruments: [{ method: 'upi', flows: ['collect'] }],
          },
          cards: {
            name: 'Cards',
            instruments: [{ method: 'card' }],
          },
          netbanking: {
            name: 'Netbanking',
            instruments: [{ method: 'netbanking' }],
          },
          wallets: {
            name: 'Wallets',
            instruments: [{ method: 'wallet' }],
          },
        },
        sequence: ['block.upi_apps', 'block.upi_id', 'block.cards', 'block.netbanking', 'block.wallets'],
        preferences: {
          show_default_blocks: true,
        },
      },
    },
  };
}

export function ensureRazorpayScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SCRIPT}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load payment checkout.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load payment checkout.'));
    document.body.appendChild(script);
  });
}

export async function openNativeRazorpayCheckout(options: RazorpayNativeLayoutOptions) {
  await ensureRazorpayScript();
  if (!window.Razorpay) throw new Error('Could not load payment checkout.');

  const native = razorpayNativeCheckoutOptions();
  lockBodyForCheckout();
  startSafeAreaObserver();

  let settled = false;
  let successFired = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    unlockBodyScroll();
  };

  const razorpay = new window.Razorpay({
    key: options.key,
    amount: options.amount,
    currency: options.currency || 'INR',
    name: options.name,
    description: options.description,
    order_id: options.order_id,
    prefill: options.prefill,
    notes: options.notes,
    theme: options.theme || { color: '#2D4A3E' },
    ...native,
    handler: (response: RazorpayCheckoutSuccess) => {
      successFired = true;
      finish();
      options.handler(response);
    },
    modal: {
      ondismiss: () => {
        if (successFired) return;
        finish();
        options.onDismiss?.();
      },
      escape: true,
      backdropclose: false,
      confirm_close: true,
      animation: false,
    },
  });

  razorpay.on('payment.failed', (response: { error?: unknown }) => {
    if (successFired) return;
    finish();
    options.onFailure?.(response?.error || response);
  });

  requestAnimationFrame(() => {
    try {
      razorpay.open();
    } catch (error) {
      finish();
      throw error;
    }
  });

  return razorpay;
}
