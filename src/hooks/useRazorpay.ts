// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { hasRazorpayCheckout, isLikelyRazorpayNode } from '@/lib/razorpay-checkout-dom';
import {
  applyNativeCheckoutLayout,
  getRazorpayNativeLayout,
  lockBodyForCheckout,
  razorpayNativeCheckoutOptions,
  startSafeAreaObserver,
  unlockBodyScroll,
  RAZORPAY_CHECKOUT_SCRIPT,
} from '@/lib/razorpay-native-checkout';
import { notify } from '@/lib/notify';

declare global {
  interface Window {
    Razorpay: any;
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
    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SCRIPT}"]`);
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_SCRIPT;
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
    // Duplicate payment protection: check if order already has a successful payment
    const { data: existingOrder, error: orderError } = await supabase
      .from('orders')
      .select('payment_status, razorpay_payment_id')
      .eq('id', options.orderId)
      .single();

    if (orderError) {
      console.error('Failed to fetch order for duplicate payment check:', orderError);
      // Continue with payment creation if we can't check (fail open for payment attempts)
    } else if (
      existingOrder.payment_status === 'paid' ||
      existingOrder.payment_status === 'buyer_confirmed' ||
      (existingOrder.razorpay_payment_id && existingOrder.payment_status !== 'failed')
    ) {
      toast.error('A payment has already been processed for this order');
      setIsLoading(false);
      return;
    }

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
        ...razorpayNativeCheckoutOptions(),
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

        // Delayed re-sweeps to catch late-injected elements
        const sweep = () => {
          // Check all div elements for Razorpay container (broad but safe with isLikelyRazorpayNode check)
          document.body.querySelectorAll<HTMLElement>('div').forEach((el) => {
            if (isLikelyRazorpayNode(el)) {
              markModalDetected();
              applyNativeCheckoutLayout(el, nativeLayout);
            }
          });
        };
        // Run sweeps at increasing intervals up to 30 seconds to catch late injections
        setTimeout(sweep, 100);
        setTimeout(sweep, 250);
        setTimeout(sweep, 500);
        setTimeout(sweep, 1000);
        setTimeout(sweep, 2000);
        setTimeout(sweep, 4000);
        setTimeout(sweep, 8000);
        setTimeout(sweep, 12000);
        setTimeout(sweep, 18000);
        setTimeout(sweep, 25000);
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