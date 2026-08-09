// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { hasRazorpayCheckout, isLikelyRazorpayNode } from '@/lib/razorpay-checkout-dom';
import { notify } from '@/lib/notify';

declare global {
  interface Window {
    Razorpay: any;
  }
}

/** MutationObserver ref — disconnected on payment end */
let razorpayDomObserver: MutationObserver | null = null;

type RazorpayNativeLayout = 'android-fullscreen' | 'ios-sheet' | null;

function getRazorpayNativeLayout(): RazorpayNativeLayout {
  if (!Capacitor.isNativePlatform()) return null;
  return Capacitor.getPlatform() === 'ios' ? 'ios-sheet' : 'android-fullscreen';
}

/**
 * Native layout patches for Checkout.js overlays.
 * Android: full viewport + a single --app-safe-top inset (avoids 88vh gap / double padding).
 * iOS: bottom sheet so the modal clears the notch without fighting WKWebView safe-area.
 * Web: no layout overrides — leave Checkout.js defaults.
 * Only patch direct body children so nested frames do not stack a second inset.
 */
function applyNativeCheckoutLayout(node: HTMLElement, layout: RazorpayNativeLayout) {
  if (!layout) return;
  if (node.parentElement !== document.body) return;
  if (!isLikelyRazorpayNode(node)) return;

  node.style.setProperty('left', '0', 'important');
  node.style.setProperty('right', '0', 'important');
  node.style.setProperty('width', '100%', 'important');
  node.style.setProperty('overflow', 'hidden', 'important');
  node.style.setProperty('background-color', '#fff', 'important');
  node.style.setProperty('box-sizing', 'border-box', 'important');

  // Both Android and iOS: full-screen with platform safe-area insets.
  // iOS was previously a bottom-sheet (88vh) which hid the Razorpay header
  // behind the status bar and made the close button inaccessible.
  node.style.setProperty('top', '0', 'important');
  node.style.setProperty('bottom', '0', 'important');
  node.style.setProperty('height', '100%', 'important');
  node.style.setProperty('max-height', '100%', 'important');
  node.style.setProperty('border-radius', '0', 'important');

  if (layout === 'android-fullscreen') {
    // Capacitor publishes --app-safe-* CSS vars; env() is unreliable on Android.
    node.style.setProperty('padding-top', 'var(--app-safe-top, 0px)', 'important');
    node.style.setProperty('padding-bottom', 'var(--app-safe-bottom, 0px)', 'important');
    node.style.setProperty('padding-left', '0', 'important');
    node.style.setProperty('padding-right', '0', 'important');
    return;
  }

  // iOS full-screen: use env() which is reliable in WKWebView.
  node.style.setProperty('padding-top', 'env(safe-area-inset-top, 44px)', 'important');
  node.style.setProperty('padding-bottom', 'env(safe-area-inset-bottom, 0px)', 'important');
  node.style.setProperty('padding-left', '0', 'important');
  node.style.setProperty('padding-right', '0', 'important');
}

/** Watch for Razorpay-injected overlays and apply native layout patches */
function startSafeAreaObserver(onDetected?: () => void) {
  stopSafeAreaObserver();
  const layout = getRazorpayNativeLayout();

  const patchNode = (node: HTMLElement) => {
    if (!isLikelyRazorpayNode(node)) return;
    onDetected?.();
    applyNativeCheckoutLayout(node, layout);
  };

  razorpayDomObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added instanceof HTMLElement) {
          patchNode(added);
        }
      }
      // Also re-patch if Razorpay SDK resets inline styles
      if (m.type === 'attributes' && m.target instanceof HTMLElement) {
        patchNode(m.target);
      }
    }
  });

  razorpayDomObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });

  // Also patch any already-present high z-index children (race condition guard)
  document.body.querySelectorAll<HTMLElement>(':scope > div').forEach(patchNode);
}

function stopSafeAreaObserver() {
  if (razorpayDomObserver) {
    razorpayDomObserver.disconnect();
    razorpayDomObserver = null;
  }
}

interface RazorpayOptions {
  orderId: string;
  orderIds?: string[];
  amount: number;
  sellerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  businessName: string;
  onSuccess: (paymentId: string, razorpayOrderId?: string) => void;
  onFailure: (error: any) => void;
  onDismiss?: () => void;
}

/** Restore body scroll position and remove the lock class */
function unlockBodyScroll() {
  stopSafeAreaObserver();
  document.body.classList.remove('razorpay-active', 'razorpay-android', 'razorpay-ios');
  document.body.style.removeProperty('top');
  const savedY = parseInt(document.body.dataset.scrollY || '0', 10);
  window.scrollTo(0, savedY);
  delete document.body.dataset.scrollY;
}

function lockBodyForCheckout() {
  const scrollY = window.scrollY;
  document.body.dataset.scrollY = String(scrollY);
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('razorpay-active');
  document.body.classList.remove('razorpay-android', 'razorpay-ios');
  const layout = getRazorpayNativeLayout();
  if (layout === 'android-fullscreen') document.body.classList.add('razorpay-android');
  if (layout === 'ios-sheet') document.body.classList.add('razorpay-ios');
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export function useRazorpay() {
  const [isLoading, setIsLoading] = useState(false);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const retryCountRef = useRef(0);
  const popupCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAttemptRef = useRef(0);
  const paymentSettledRef = useRef(false);
  const pageHiddenDuringOpenRef = useRef(false);
  const visibilityCleanupRef = useRef<(() => void) | null>(null);

  const clearPopupCheck = useCallback(() => {
    if (popupCheckTimeoutRef.current) {
      clearTimeout(popupCheckTimeoutRef.current);
      popupCheckTimeoutRef.current = null;
    }
  }, []);

  const cleanupOpenAttempt = useCallback(() => {
    clearPopupCheck();
    visibilityCleanupRef.current?.();
    visibilityCleanupRef.current = null;
  }, [clearPopupCheck]);

  const settleAttempt = useCallback(() => {
    paymentSettledRef.current = true;
    cleanupOpenAttempt();
  }, [cleanupOpenAttempt]);

  // Load Razorpay script with retry
  const loadScript = useCallback(() => {
    if (window.Razorpay) {
      setIsScriptLoaded(true);
      setScriptError(false);
      return;
    }

    // Remove any previous failed script tag
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      setIsScriptLoaded(true);
      setScriptError(false);
      retryCountRef.current = 0;
    };
    script.onerror = () => {
      console.error('Failed to load Razorpay script');
      setScriptError(true);
      // Auto-retry up to 3 times with exponential backoff
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        const delay = Math.pow(2, retryCountRef.current) * 1000;
        setTimeout(loadScript, delay);
      } else {
        toast.error('Payment service unavailable. Please check your network.');
      }
    };
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    loadScript();
  }, [loadScript]);

  // Cleanup: ensure body scroll lock is released if hook unmounts mid-payment
  useEffect(() => {
    return () => {
      cleanupOpenAttempt();
      if (document.body.classList.contains('razorpay-active')) {
        unlockBodyScroll();
      }
    };
  }, [cleanupOpenAttempt]);

  const createOrder = useCallback(async (options: RazorpayOptions) => {
    if (!isScriptLoaded) {
      if (scriptError) {
        // Retry loading script
        retryCountRef.current = 0;
        loadScript();
        toast.error('Payment service is loading. Please try again in a moment.');
      } else {
        toast.error('Payment service is loading. Please try again.');
      }
      return;
    }

    setIsLoading(true);

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        notify.block('Please login to continue');
        return;
      }

      const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
        body: {
          orderId: options.orderId,
          orderIds: options.orderIds || [options.orderId],
          amount: options.amount,
          sellerId: options.sellerId,
          customerName: options.customerName,
          customerEmail: options.customerEmail,
          customerPhone: options.customerPhone,
        },
      });

      if (error) {
        console.error('Create order error:', error);
        throw new Error(error.message || 'Failed to create payment order');
      }

      console.log('Razorpay order created:', data);

      const attemptId = activeAttemptRef.current + 1;
      activeAttemptRef.current = attemptId;
      paymentSettledRef.current = false;
      pageHiddenDuringOpenRef.current = false;

      const markModalDetected = () => {
        if (activeAttemptRef.current !== attemptId || paymentSettledRef.current) return;
        clearPopupCheck();
      };

      const handleVisibilityChange = () => {
        if (document.hidden) {
          pageHiddenDuringOpenRef.current = true;
          clearPopupCheck();
        } else if (!paymentSettledRef.current && activeAttemptRef.current === attemptId && !hasRazorpayCheckout(document)) {
          popupCheckTimeoutRef.current = setTimeout(() => {
            if (paymentSettledRef.current || activeAttemptRef.current !== attemptId) return;
            if (hasRazorpayCheckout(document) || pageHiddenDuringOpenRef.current) return;
            unlockBodyScroll();
            settleAttempt();
            options.onFailure({ code: 'POPUP_BLOCKED', description: 'Payment window could not open. Try again from the published app.' });
          }, 1500);
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      visibilityCleanupRef.current = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };

      // Open Razorpay checkout
      let successFired = false;
      const razorpayOptions = {
        key: data.razorpay_key_id,
        amount: data.amount,
        currency: data.currency,
        name: options.businessName,
        description: `Order Payment`,
        order_id: data.razorpay_order_id,
        prefill: data.prefill,
        notes: data.notes,
        theme: {
          color: '#2D4A3E',
        },
        // CRITICAL: Enable UPI intent inside Capacitor WebView
        webview_intent: true,
        // iOS WKWebView blocks window.open() by default — tell Razorpay to use
        // embedded iframe mode instead of popup so payment never gets "blocked".
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
              upi: {
                name: 'Pay via UPI',
                instruments: [
                  // Show ALL installed UPI apps (not just gpay/phonepe/paytm)
                  { method: 'upi', flows: ['intent'] },
                  // Fallback: manual UPI ID entry for apps not detected via intent
                  { method: 'upi', flows: ['collect'] },
                ],
              },
              other: {
                name: 'Other Payment Methods',
                instruments: [
                  { method: 'card' },
                  { method: 'netbanking' },
                  { method: 'wallet' },
                ],
              },
            },
            sequence: ['block.upi', 'block.other'],
            preferences: {
              show_default_blocks: false,
            },
          },
        },
        handler: function (response: any) {
          console.log('Payment successful:', response);
          successFired = true; // Prevent ondismiss from resetting state
          settleAttempt();
          unlockBodyScroll();
          options.onSuccess(response.razorpay_payment_id, response.razorpay_order_id);
        },
        modal: {
          ondismiss: function () {
            // Race-proof: Razorpay fires ondismiss AFTER handler in some SDK versions.
            // If success already fired, skip dismiss entirely to prevent state reset.
            if (successFired) {
              console.log('[Razorpay] ondismiss suppressed — success already fired');
              return;
            }
            console.log('Payment modal closed');
            settleAttempt();
            unlockBodyScroll();
            setIsLoading(false);
            options.onDismiss?.();
          },
          escape: true,
          backdropclose: false,
          confirm_close: true,
          animation: false,
        },
      };

      const razorpay = new window.Razorpay(razorpayOptions);
      
      razorpay.on('payment.failed', function (response: any) {
        console.error('Payment failed:', response.error);
        settleAttempt();
        unlockBodyScroll();
        options.onFailure(response.error);
      });

      // Save scroll position and lock body in place (platform class drives CSS layout)
      lockBodyForCheckout();
      const nativeLayout = getRazorpayNativeLayout();

      // Open Razorpay — use rAF to ensure the CSS changes are painted
      // before the SDK injects its overlay, preventing the brief
      // non-interactive flash on iOS WebView
      requestAnimationFrame(() => {
        // Start observing before open so slow or early DOM injection never misses detection
        startSafeAreaObserver(markModalDetected);

        try {
          razorpay.open();
        } catch (openError) {
          settleAttempt();
          unlockBodyScroll();
          throw openError;
        }

        // ── Popup-blocked detection ──
        // Only fire if the page stayed visible and no Razorpay DOM ever appeared.
        clearPopupCheck();
        popupCheckTimeoutRef.current = setTimeout(() => {
          if (paymentSettledRef.current || activeAttemptRef.current !== attemptId) return;

          if (hasRazorpayCheckout(document)) {
            markModalDetected();
            return;
          }

          if (document.hidden || pageHiddenDuringOpenRef.current) {
            console.info('[Razorpay] Skipping popup-blocked fallback because payment triggered an app/browser handoff');
            return;
          }

          console.warn('[Razorpay] Popup not detected after guarded open check');
          unlockBodyScroll();
          settleAttempt();
          options.onFailure({ code: 'POPUP_BLOCKED', description: 'Payment window could not open. Try again from the published app.' });
        }, 3500);

        // Delayed re-sweeps to catch late-injected elements (native only)
        if (nativeLayout) {
          const sweep = () => document.body.querySelectorAll<HTMLElement>(':scope > div').forEach((el) => {
            if (isLikelyRazorpayNode(el)) {
              markModalDetected();
              applyNativeCheckoutLayout(el, nativeLayout);
            }
          });
          setTimeout(sweep, 100);
          setTimeout(sweep, 500);
          setTimeout(sweep, 1000);
        }
      });
    } catch (error: any) {
      console.error('Razorpay error:', error);
      settleAttempt();
      unlockBodyScroll();
      toast.error(friendlyError(error));
      options.onFailure(error);
    } finally {
      setIsLoading(false);
    }
  }, [isScriptLoaded, scriptError, loadScript]);

  return {
    createOrder,
    isLoading,
    isScriptLoaded,
    scriptError,
    retryLoadScript: loadScript,
  };
}
